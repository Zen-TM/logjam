package expo.modules.logjampdfrenderer

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream

// Stage 0 spike 3: prove android.graphics.pdf.PdfRenderer is reachable from an
// Expo local native module and can rasterise a PDF page to a bitmap. The real
// Stage 6 rasteriser (tile pyramid, MBTiles writer) replaces this; keep this
// module's surface minimal until then.
class LogjamPdfRendererModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("LogjamPdfRenderer")

    AsyncFunction("renderPage") { pdfPath: String, pageIndex: Int, scale: Double, outputPngPath: String ->
      val pdfFile = File(pdfPath)
      if (!pdfFile.exists()) {
        throw CodedException("ERR_PDF_NOT_FOUND", "No file at $pdfPath", null)
      }
      ParcelFileDescriptor.open(pdfFile, ParcelFileDescriptor.MODE_READ_ONLY).use { descriptor ->
        PdfRenderer(descriptor).use { renderer ->
          if (pageIndex < 0 || pageIndex >= renderer.pageCount) {
            throw CodedException(
              "ERR_PAGE_OUT_OF_RANGE",
              "Page $pageIndex outside 0..${renderer.pageCount - 1}",
              null
            )
          }
          renderer.openPage(pageIndex).use { page ->
            val widthPx = (page.width * scale).toInt()
            val heightPx = (page.height * scale).toInt()
            val bitmap = Bitmap.createBitmap(widthPx, heightPx, Bitmap.Config.ARGB_8888)
            // PdfRenderer composites onto transparent by default; PDFs assume white.
            bitmap.eraseColor(Color.WHITE)
            page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
            FileOutputStream(outputPngPath).use { stream ->
              bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream)
            }
            bitmap.recycle()
            mapOf(
              "pageCount" to renderer.pageCount,
              "pageWidthPts" to page.width,
              "pageHeightPts" to page.height,
              "renderedWidthPx" to widthPx,
              "renderedHeightPx" to heightPx
            )
          }
        }
      }
    }
  }
}
