package expo.modules.logjampdfrenderer

import android.database.sqlite.SQLiteDatabase
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.Executors
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

// Stage 6 native rasteriser (stage6-geopdf.md §4): renders GeoPDF page regions
// with android.graphics.pdf.PdfRenderer, warps them into Web Mercator XYZ
// tiles (affine fast path or forward mesh via drawBitmapMesh), and writes
// PNG tiles into an MBTiles SQLite file. No bitmap ever crosses the JS
// bridge — JS sends warp specs (a few hundred floats per tile) and receives
// counts.
//
// PdfRenderer constraints honoured here: the class is NOT thread-safe and
// only one page may be open at a time — every operation runs on one dedicated
// worker thread, and a page is opened once per batch.

private const val SOURCE_BITMAP_CAP_PX = 4096

private class OpenDocument(
  val descriptor: ParcelFileDescriptor,
  val renderer: PdfRenderer,
)

class WarpSpec : Record {
  @Field var kind: String = "affine"
  // affine: page pt -> tile px, [a, b, c, d, e, f]
  @Field var m: List<Double>? = null
  // mesh: (grid+1)^2 x 2 tile-px coords, row-major from srcRect bottom-left
  @Field var grid: Int = 0
  @Field var dst: List<Double>? = null
}

class SrcRect : Record {
  @Field var x0: Double = 0.0
  @Field var y0: Double = 0.0
  @Field var x1: Double = 0.0
  @Field var y1: Double = 0.0
}

class TileJob : Record {
  @Field var z: Int = 0
  @Field var x: Int = 0
  @Field var y: Int = 0
  @Field var warp: WarpSpec = WarpSpec()
  @Field var srcRect: SrcRect = SrcRect()
}

class PagePoint : Record {
  @Field var x: Double = 0.0
  @Field var y: Double = 0.0
}

class RasteriseBatchOptions : Record {
  @Field var page: Int = 0
  @Field var mbtilesUri: String = ""
  @Field var tileSize: Int = 512
  @Field var clipPolygonPt: List<PagePoint>? = null
  @Field var tiles: List<TileJob> = emptyList()
  // Serialized JSON checkpoint written to metadata logjam:build_state inside
  // the batch transaction (resume support); null leaves it untouched.
  @Field var buildState: String? = null
}

class LogjamPdfRendererModule : Module() {
  private val documents = HashMap<Int, OpenDocument>()
  private var nextHandle = 1
  // Single worker: PdfRenderer is not thread-safe; SQLite writes serialize too.
  private val executor = Executors.newSingleThreadExecutor()

  private fun pathFromUri(uri: String): String =
    if (uri.startsWith("file://")) uri.removePrefix("file://") else uri

  private fun documentOrThrow(handle: Int): OpenDocument =
    documents[handle] ?: throw CodedException("ERR_BAD_HANDLE", "No open document $handle", null)

  private fun openMbtiles(uri: String): SQLiteDatabase =
    SQLiteDatabase.openDatabase(
      pathFromUri(uri),
      null,
      SQLiteDatabase.OPEN_READWRITE or SQLiteDatabase.CREATE_IF_NECESSARY,
    )

  override fun definition() = ModuleDefinition {
    Name("LogjamPdfRenderer")

    AsyncFunction("open") { fileUri: String, promise: Promise ->
      executor.execute {
        try {
          val file = File(pathFromUri(fileUri))
          if (!file.exists()) {
            throw CodedException("ERR_PDF_NOT_FOUND", "No file at given path", null)
          }
          val descriptor = ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
          val renderer = try {
            PdfRenderer(descriptor)
          } catch (err: Throwable) {
            descriptor.close()
            throw CodedException("ERR_PDF_OPEN", err.message ?: "PdfRenderer failed", err)
          }
          val handle = nextHandle++
          documents[handle] = OpenDocument(descriptor, renderer)
          val pages = ArrayList<Map<String, Int>>(renderer.pageCount)
          for (i in 0 until renderer.pageCount) {
            renderer.openPage(i).use { page ->
              pages.add(mapOf("widthPt" to page.width, "heightPt" to page.height))
            }
          }
          promise.resolve(
            mapOf("handle" to handle, "pageCount" to renderer.pageCount, "pages" to pages),
          )
        } catch (err: CodedException) {
          promise.reject(err)
        } catch (err: Throwable) {
          promise.reject(CodedException("ERR_PDF_OPEN", err.message, err))
        }
      }
    }

    AsyncFunction("close") { handle: Int, promise: Promise ->
      executor.execute {
        documents.remove(handle)?.let {
          it.renderer.close()
          it.descriptor.close()
        }
        promise.resolve(null)
      }
    }

    // Render a page region (PDF points, origin bottom-left) to a PNG of the
    // requested pixel size. Import-preview thumbnail + golden-image debugging.
    AsyncFunction("renderRegion") {
      handle: Int, pageIndex: Int, rect: SrcRect, outPxWidth: Int, outPxHeight: Int, outFileUri: String, promise: Promise ->
      executor.execute {
        try {
          val doc = documentOrThrow(handle)
          doc.renderer.openPage(pageIndex).use { page ->
            val bitmap = renderPageRegion(page, rect, outPxWidth, outPxHeight)
            FileOutputStream(pathFromUri(outFileUri)).use { stream ->
              bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream)
            }
            bitmap.recycle()
          }
          promise.resolve(null)
        } catch (err: CodedException) {
          promise.reject(err)
        } catch (err: Throwable) {
          promise.reject(CodedException("ERR_RENDER", err.message, err))
        }
      }
    }

    AsyncFunction("createMbtiles") { fileUri: String, metadata: Map<String, String>, promise: Promise ->
      executor.execute {
        try {
          openMbtiles(fileUri).use { db ->
            // rawQuery: journal_mode PRAGMAs return a row; execSQL rejects that.
            db.rawQuery("PRAGMA journal_mode=WAL", null).close()
            db.execSQL("CREATE TABLE IF NOT EXISTS metadata (name TEXT, value TEXT)")
            db.execSQL(
              "CREATE TABLE IF NOT EXISTS tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB)",
            )
            db.execSQL(
              "CREATE UNIQUE INDEX IF NOT EXISTS tile_index ON tiles (zoom_level, tile_column, tile_row)",
            )
            db.beginTransaction()
            try {
              for ((key, value) in metadata) upsertMetadata(db, key, value)
              db.setTransactionSuccessful()
            } finally {
              db.endTransaction()
            }
          }
          promise.resolve(null)
        } catch (err: Throwable) {
          promise.reject(CodedException("ERR_MBTILES", err.message, err))
        }
      }
    }

    AsyncFunction("rasteriseBatch") { handle: Int, options: RasteriseBatchOptions, promise: Promise ->
      executor.execute {
        try {
          val doc = documentOrThrow(handle)
          var written = 0
          doc.renderer.openPage(options.page).use { page ->
            openMbtiles(options.mbtilesUri).use { db ->
              db.beginTransaction()
              try {
                for (tile in options.tiles) {
                  val png = rasteriseTile(page, tile, options.tileSize, options.clipPolygonPt)
                  val tmsRow = (1 shl tile.z) - 1 - tile.y
                  db.execSQL(
                    "INSERT OR REPLACE INTO tiles (zoom_level, tile_column, tile_row, tile_data) VALUES (?, ?, ?, ?)",
                    arrayOf(tile.z, tile.x, tmsRow, png),
                  )
                  written++
                }
                options.buildState?.let { upsertMetadata(db, "logjam:build_state", it) }
                db.setTransactionSuccessful()
              } finally {
                db.endTransaction()
              }
            }
          }
          promise.resolve(mapOf("written" to written))
        } catch (err: CodedException) {
          promise.reject(err)
        } catch (err: Throwable) {
          promise.reject(CodedException("ERR_RASTERISE", err.message, err))
        }
      }
    }

    // Build overview level fromZ-1 by downsampling the four children of each
    // parent tile 50% (bilinear) onto transparent (deviation D3: one PDF
    // render pass at zMax, pyramid by downsampling).
    AsyncFunction("downsampleLevel") { mbtilesUri: String, fromZ: Int, tileSize: Int, buildState: String?, promise: Promise ->
      executor.execute {
        try {
          var written = 0
          openMbtiles(mbtilesUri).use { db ->
            val toZ = fromZ - 1
            // Distinct parents of existing children at fromZ (TMS rows in-db).
            val parents = LinkedHashSet<Pair<Int, Int>>()
            db.rawQuery(
              "SELECT tile_column, tile_row FROM tiles WHERE zoom_level = ?",
              arrayOf(fromZ.toString()),
            ).use { cursor ->
              while (cursor.moveToNext()) {
                val x = cursor.getInt(0)
                val tmsRow = cursor.getInt(1)
                val yXyz = (1 shl fromZ) - 1 - tmsRow
                parents.add(Pair(x / 2, yXyz / 2))
              }
            }
            db.beginTransaction()
            try {
              for ((px, py) in parents) {
                val parent = Bitmap.createBitmap(tileSize, tileSize, Bitmap.Config.ARGB_8888)
                val canvas = Canvas(parent)
                val paint = Paint(Paint.FILTER_BITMAP_FLAG)
                var any = false
                for (dy in 0..1) {
                  for (dx in 0..1) {
                    val childX = px * 2 + dx
                    val childYXyz = py * 2 + dy
                    val childTms = (1 shl fromZ) - 1 - childYXyz
                    db.rawQuery(
                      "SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?",
                      arrayOf(fromZ.toString(), childX.toString(), childTms.toString()),
                    ).use { cursor ->
                      if (cursor.moveToFirst()) {
                        val blob = cursor.getBlob(0)
                        val child = android.graphics.BitmapFactory.decodeByteArray(blob, 0, blob.size)
                        if (child != null) {
                          val half = tileSize / 2
                          canvas.drawBitmap(
                            child,
                            Rect(0, 0, child.width, child.height),
                            RectF(
                              (dx * half).toFloat(),
                              (dy * half).toFloat(),
                              ((dx + 1) * half).toFloat(),
                              ((dy + 1) * half).toFloat(),
                            ),
                            paint,
                          )
                          child.recycle()
                          any = true
                        }
                      }
                    }
                  }
                }
                if (any) {
                  val tmsRow = (1 shl toZ) - 1 - py
                  db.execSQL(
                    "INSERT OR REPLACE INTO tiles (zoom_level, tile_column, tile_row, tile_data) VALUES (?, ?, ?, ?)",
                    arrayOf(toZ, px, tmsRow, encodePng(parent)),
                  )
                  written++
                }
                parent.recycle()
              }
              buildState?.let { upsertMetadata(db, "logjam:build_state", it) }
              db.setTransactionSuccessful()
            } finally {
              db.endTransaction()
            }
          }
          promise.resolve(mapOf("written" to written))
        } catch (err: Throwable) {
          promise.reject(CodedException("ERR_DOWNSAMPLE", err.message, err))
        }
      }
    }

    AsyncFunction("finalizeMbtiles") { fileUri: String, metadata: Map<String, String>, promise: Promise ->
      executor.execute {
        try {
          openMbtiles(fileUri).use { db ->
            db.beginTransaction()
            try {
              for ((key, value) in metadata) upsertMetadata(db, key, value)
              db.execSQL("DELETE FROM metadata WHERE name = 'logjam:build_state'")
              db.setTransactionSuccessful()
            } finally {
              db.endTransaction()
            }
            db.rawQuery("PRAGMA journal_mode=DELETE", null).close()
            db.rawQuery("PRAGMA optimize", null).close()
          }
          promise.resolve(null)
        } catch (err: Throwable) {
          promise.reject(CodedException("ERR_MBTILES", err.message, err))
        }
      }
    }

    // Read one metadata value (resume: JS reads logjam:build_state on relaunch).
    AsyncFunction("readMbtilesMetadata") { fileUri: String, key: String, promise: Promise ->
      executor.execute {
        try {
          openMbtiles(fileUri).use { db ->
            db.rawQuery("SELECT value FROM metadata WHERE name = ?", arrayOf(key)).use { cursor ->
              promise.resolve(if (cursor.moveToFirst()) cursor.getString(0) else null)
            }
          }
        } catch (err: Throwable) {
          promise.reject(CodedException("ERR_MBTILES", err.message, err))
        }
      }
    }

    OnDestroy {
      executor.execute {
        for (doc in documents.values) {
          doc.renderer.close()
          doc.descriptor.close()
        }
        documents.clear()
      }
      executor.shutdown()
    }
  }

  // ── Rendering internals ────────────────────────────────────────────────────

  /**
   * Render the page region `rect` (PDF points, origin BOTTOM-left) into a
   * bitmap of outW×outH. PdfRenderer's page space is TOP-left origin in
   * points — the y-flip happens here and nowhere else.
   */
  private fun renderPageRegion(page: PdfRenderer.Page, rect: SrcRect, outW: Int, outH: Int): Bitmap {
    val bitmap = Bitmap.createBitmap(outW, outH, Bitmap.Config.ARGB_8888)
    // PDFs assume a white backdrop; PdfRenderer composites onto transparent.
    bitmap.eraseColor(Color.WHITE)
    val scaleX = outW / (rect.x1 - rect.x0)
    val scaleY = outH / (rect.y1 - rect.y0)
    // Renderer-space y of the region's TOP edge is pageHeight − rect.y1.
    val topRendererY = page.height - rect.y1
    val matrix = Matrix()
    matrix.setScale(scaleX.toFloat(), scaleY.toFloat())
    matrix.postTranslate(
      (-rect.x0 * scaleX).toFloat(),
      (-topRendererY * scaleY).toFloat(),
    )
    page.render(bitmap, null, matrix, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
    return bitmap
  }

  private fun encodePng(bitmap: Bitmap): ByteArray {
    val out = ByteArrayOutputStream()
    bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
    return out.toByteArray()
  }

  /** tile-px-per-page-pt scale implied by the warp. */
  private fun warpScale(tile: TileJob): Double {
    val warp = tile.warp
    if (warp.kind == "affine") {
      val m = warp.m ?: throw CodedException("ERR_WARP", "affine warp missing m", null)
      return sqrt(abs(m[0] * m[4] - m[1] * m[3]))
    }
    val dst = warp.dst ?: throw CodedException("ERR_WARP", "mesh warp missing dst", null)
    // Mean px extent of the mesh vs the page extent of srcRect.
    var minX = Double.MAX_VALUE; var maxX = -Double.MAX_VALUE
    var minY = Double.MAX_VALUE; var maxY = -Double.MAX_VALUE
    var i = 0
    while (i < dst.size) {
      minX = min(minX, dst[i]); maxX = max(maxX, dst[i])
      minY = min(minY, dst[i + 1]); maxY = max(maxY, dst[i + 1])
      i += 2
    }
    val sx = (maxX - minX) / (tile.srcRect.x1 - tile.srcRect.x0)
    val sy = (maxY - minY) / (tile.srcRect.y1 - tile.srcRect.y0)
    return max(sx, sy)
  }

  private fun rasteriseTile(
    page: PdfRenderer.Page,
    tile: TileJob,
    tileSize: Int,
    clipPolygonPt: List<PagePoint>?,
  ): ByteArray {
    val rect = tile.srcRect
    var s = warpScale(tile)
    var srcW = ceil((rect.x1 - rect.x0) * s).toInt().coerceAtLeast(1)
    var srcH = ceil((rect.y1 - rect.y0) * s).toInt().coerceAtLeast(1)
    if (srcW > SOURCE_BITMAP_CAP_PX || srcH > SOURCE_BITMAP_CAP_PX) {
      val shrink = SOURCE_BITMAP_CAP_PX.toDouble() / max(srcW, srcH)
      s *= shrink
      srcW = (srcW * shrink).toInt().coerceAtLeast(1)
      srcH = (srcH * shrink).toInt().coerceAtLeast(1)
    }

    val source = renderPageRegion(page, rect, srcW, srcH)
    val tileBitmap = Bitmap.createBitmap(tileSize, tileSize, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(tileBitmap)
    val paint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)

    // Actual px-per-pt of the rendered source (ceil/cap may skew it slightly).
    val sx = srcW / (rect.x1 - rect.x0)
    val sy = srcH / (rect.y1 - rect.y0)

    // page pt → source-bitmap px (bitmap y down from the region's top edge)
    fun pageToSrcPx(x: Double, y: Double): Pair<Double, Double> =
      Pair((x - rect.x0) * sx, (rect.y1 - y) * sy)

    val warp = tile.warp
    val clipPath = clipPolygonPt?.let { polygon ->
      val path = Path()
      polygon.forEachIndexed { i, vertex ->
        val (tx, ty) = warpPagePtToTilePx(tile, vertex.x, vertex.y)
        if (i == 0) path.moveTo(tx.toFloat(), ty.toFloat())
        else path.lineTo(tx.toFloat(), ty.toFloat())
      }
      path.close()
      path
    }
    if (clipPath != null) {
      canvas.save()
      canvas.clipPath(clipPath)
    }

    if (warp.kind == "affine") {
      val m = warp.m!!
      // Compose source-px → page-pt → tile-px into one affine.
      val a = (m[0] / sx).toFloat()
      val b = (-m[1] / sy).toFloat()
      val c = (m[0] * rect.x0 + m[1] * rect.y1 + m[2]).toFloat()
      val d = (m[3] / sx).toFloat()
      val e = (-m[4] / sy).toFloat()
      val f = (m[3] * rect.x0 + m[4] * rect.y1 + m[5]).toFloat()
      val matrix = Matrix()
      matrix.setValues(floatArrayOf(a, b, c, d, e, f, 0f, 0f, 1f))
      canvas.drawBitmap(source, matrix, paint)
    } else {
      val grid = warp.grid
      val dst = warp.dst!!
      // Our mesh rows run bottom→top of srcRect (page space); drawBitmapMesh
      // rows run top→bottom of the source bitmap. Flip row order.
      val verts = FloatArray((grid + 1) * (grid + 1) * 2)
      for (row in 0..grid) {
        val srcRow = grid - row
        for (col in 0..grid) {
          val from = 2 * (srcRow * (grid + 1) + col)
          val to = 2 * (row * (grid + 1) + col)
          verts[to] = dst[from].toFloat()
          verts[to + 1] = dst[from + 1].toFloat()
        }
      }
      canvas.drawBitmapMesh(source, grid, grid, verts, 0, null, 0, paint)
    }

    if (clipPath != null) canvas.restore()
    source.recycle()
    val png = encodePng(tileBitmap)
    tileBitmap.recycle()
    return png
  }

  /** Map a page point through the tile's warp (exact affine; mesh bilinear). */
  private fun warpPagePtToTilePx(tile: TileJob, x: Double, y: Double): Pair<Double, Double> {
    val warp = tile.warp
    if (warp.kind == "affine") {
      val m = warp.m!!
      return Pair(m[0] * x + m[1] * y + m[2], m[3] * x + m[4] * y + m[5])
    }
    val grid = warp.grid
    val dst = warp.dst!!
    val rect = tile.srcRect
    // Bilinear over the mesh lattice; extrapolates linearly outside srcRect,
    // which is fine for clip vertices just past the edge.
    val gx = (x - rect.x0) / (rect.x1 - rect.x0) * grid
    val gy = (y - rect.y0) / (rect.y1 - rect.y0) * grid
    val ix = floor(gx).toInt().coerceIn(0, grid - 1)
    val iy = floor(gy).toInt().coerceIn(0, grid - 1)
    val fx = gx - ix
    val fy = gy - iy
    fun node(r: Int, c: Int): Pair<Double, Double> {
      val i = 2 * (r * (grid + 1) + c)
      return Pair(dst[i], dst[i + 1])
    }
    val n00 = node(iy, ix)
    val n01 = node(iy, ix + 1)
    val n10 = node(iy + 1, ix)
    val n11 = node(iy + 1, ix + 1)
    val px = n00.first * (1 - fx) * (1 - fy) + n01.first * fx * (1 - fy) +
      n10.first * (1 - fx) * fy + n11.first * fx * fy
    val py = n00.second * (1 - fx) * (1 - fy) + n01.second * fx * (1 - fy) +
      n10.second * (1 - fx) * fy + n11.second * fx * fy
    return Pair(px, py)
  }

  private fun upsertMetadata(db: SQLiteDatabase, key: String, value: String) {
    db.execSQL("DELETE FROM metadata WHERE name = ?", arrayOf(key))
    db.execSQL("INSERT INTO metadata (name, value) VALUES (?, ?)", arrayOf(key, value))
  }
}
