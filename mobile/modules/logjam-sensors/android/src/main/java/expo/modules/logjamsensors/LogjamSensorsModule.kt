// Sensor + GNSS-status LOGGER for track-accuracy research. Writes CSV; reads
// nothing back. See private/todo/track-accuracy.md for what the data is for.
//
// WHY THIS EXISTS AS A NATIVE MODULE AT ALL, because it is the whole reason:
// `expo-sensors` unregisters every sensor when the activity backgrounds
// (`SensorProxy.kt`, `OnActivityEntersBackground { onHostPause() }`). A
// recording runs backgrounded with the screen off, which is exactly when the
// data is interesting, so NO sensor is reachable from JS during one. This
// registers against the application context and the SensorManager directly, so
// it lives as long as the process does — which the location foreground service
// already keeps alive.
//
// BATTERY IS THE DESIGN CONSTRAINT, and the FIFO is the whole trick. The IMU
// runs at 100 Hz but `maxReportLatencyUs` lets the sensor hub buffer batches in
// hardware (a Pixel 9's accel and gyro each hold 3000 events) and hand them
// over in one wake instead of 100 a second. Registering at this rate WITHOUT a
// report latency is a ~100x CPU cost on the rail that already dominates this
// app's power — never do it.
//
// PRIVACY: this file writes a phone's motion, plus satellite counts and signal
// strengths. It writes NO position: no lat/lon, no altitude, nothing derived
// from a fix. The log lives in app-private storage beside the databases, is
// never uploaded, and is read by pulling it off the device deliberately. Logs
// and errors here carry counts and static strings only.
package expo.modules.logjamsensors

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.hardware.TriggerEvent
import android.hardware.TriggerEventListener
import android.location.GnssStatus
import android.location.LocationManager
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.BufferedWriter
import java.io.File
import java.io.FileWriter
import java.util.concurrent.atomic.AtomicLong

class SensorLogException(message: String) : CodedException(message)

/**
 * One CSV row per sample. Columns differ per `kind`, so the file is read by
 * splitting on `kind` first — a wide fixed schema would be mostly empty at
 * 100 Hz and this file is size-bound, not schema-bound.
 *
 *   imu,<elapsedNanos>,<ax>,<ay>,<az>,<gx>,<gy>,<gz>
 *   bar,<elapsedNanos>,<hPa>
 *   stp,<elapsedNanos>,<cumulativeStepsSinceBoot>
 *   sig,<elapsedNanos>                      (significant motion fired)
 *   gnss,<elapsedNanos>,<inView>,<used>,<meanTopFourCn0>,<maxCn0>
 *
 * Times are `SystemClock.elapsedRealtimeNanos()` — the SAME clock the sensors
 * stamp their own events with, and monotonic across suspend, so a log can be
 * aligned to a track by its own wall-clock anchor row rather than by trusting
 * two different clocks to agree.
 *
 *   anchor,<elapsedNanos>,<epochMillis>
 */
private const val CSV_HEADER = "# logjam sensor log v1"

/** One barometer sample a second; see the listener for why this is enforced here. */
private const val BARO_MIN_GAP_NANOS = 900_000_000L

/**
 * Four decimals, which is below the noise floor of both parts and roughly
 * halves the file. The ICM45631's accelerometer noise density puts its real
 * precision near 1e-3 m/s^2; Java's default `Float.toString` was writing nine
 * significant figures of it, and at 200 rows a second that is the difference
 * between a log you can pull off a phone and one you cannot.
 */
private fun f(value: Float): String = String.format("%.4f", value)

/**
 * PROCESS-GLOBAL, and that is load-bearing.
 *
 * Expo instantiates a module ONCE PER JS CONTEXT, and this app has two: the UI,
 * and the headless context TaskManager relaunches for a background location
 * delivery. Holding the writer and the listeners as instance fields gave each
 * context its own — so the headless one saw `logging == false` for a log the UI
 * had already started, opened the same file a SECOND time, and registered a
 * SECOND set of sensor listeners. Two BufferedWriters appending to one file
 * interleave partial lines, and two registrations cost twice the battery.
 * Observed 2026-08-25 as four `anchor` rows in one process.
 *
 * A singleton is the fix because the resources being guarded — a file handle
 * and the SensorManager's registration table — are per-PROCESS, not per-context.
 */
private object SensorLog {
  var writer: BufferedWriter? = null
  var logFile: File? = null
  var thread: HandlerThread? = null
  var handler: Handler? = null
  val sampleCount = AtomicLong(0)
  val droppedCount = AtomicLong(0)
  var lastBaroNanos = 0L

  /**
   * The listeners live here, not on the module, for the same reason the writer
   * does: `unregisterListener` matches on OBJECT IDENTITY, so a listener
   * registered by the UI context and unregistered by the headless one would
   * simply leak — the sensors would keep running for the life of the process
   * with nothing reading them.
   */
  lateinit var sensorManager: SensorManager

  /**
   * Accelerometer and gyroscope arrive as separate events, so they are written
   * as separate rows rather than being paired up here: pairing would mean
   * holding one sample waiting for its partner, and the two streams are not
   * guaranteed to interleave one-for-one. Post-processing joins on the
   * timestamp, which is what it would have had to do anyway.
   */
  val imuListener = object : SensorEventListener {
    override fun onSensorChanged(event: SensorEvent) {
      val v = event.values
      when (event.sensor.type) {
        Sensor.TYPE_ACCELEROMETER ->
          write("acc,${event.timestamp},${f(v[0])},${f(v[1])},${f(v[2])}")
        Sensor.TYPE_GYROSCOPE ->
          write("gyr,${event.timestamp},${f(v[0])},${f(v[1])},${f(v[2])}")
        // DECIMATED IN SOFTWARE, because the platform ignores the rate we ask
        // for. Registered at 1 Hz and confirmed as `selected = 1000.00 ms` in
        // `dumpsys sensorservice`, the ICP20100 still delivers at ~12.5 Hz
        // (measured 2026-08-25) — twelve times the samples for a channel whose
        // whole use is a slow elevation profile.
        Sensor.TYPE_PRESSURE -> {
          if (event.timestamp - lastBaroNanos >= BARO_MIN_GAP_NANOS) {
            lastBaroNanos = event.timestamp
            write("bar,${event.timestamp},${v[0]}")
          }
        }
        Sensor.TYPE_STEP_COUNTER -> write("stp,${event.timestamp},${v[0].toLong()}")
      }
    }

    // Deliberately empty: accuracy changes are not filtered by sensor on this
    // callback (the same trap documented for the compass in mobile/CLAUDE.md),
    // so the value would say nothing reliable about which sensor it describes.
    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
  }

  /**
   * One-shot by contract — it must be re-armed after every fire, and forgetting
   * to is a silent loss of the whole channel rather than an error.
   */
  val motionListener = object : TriggerEventListener() {
    override fun onTrigger(event: TriggerEvent) {
      write("sig,${event.timestamp}")
      sensorManager.getDefaultSensor(Sensor.TYPE_SIGNIFICANT_MOTION)?.let {
        sensorManager.requestTriggerSensor(this, it)
      }
    }
  }

  /**
   * The channel `coords.accuracy` cannot give you. Android's accuracy figure is
   * a 68 % error estimate the fusion engine partly synthesises; satellites used
   * and C/N0 are measurements. Reported as a summary per callback rather than
   * per satellite — the per-satellite detail is ~30 rows a second for a
   * question ("is the sky visible") that four numbers answer.
   */
  val gnssCallback = object : GnssStatus.Callback() {
    override fun onSatelliteStatusChanged(status: GnssStatus) {
      var used = 0
      var maxCn0 = 0f
      val cn0s = ArrayList<Float>(status.satelliteCount)
      for (i in 0 until status.satelliteCount) {
        val cn0 = status.getCn0DbHz(i)
        cn0s.add(cn0)
        if (cn0 > maxCn0) maxCn0 = cn0
        if (status.usedInFix(i)) used++
      }
      cn0s.sortDescending()
      val topFour = cn0s.take(4)
      val meanTopFour = if (topFour.isEmpty()) 0f else topFour.sum() / topFour.size
      write(
        "gnss,${SystemClock.elapsedRealtimeNanos()}," +
          "${status.satelliteCount},$used,$meanTopFour,$maxCn0",
      )
    }
  }

  /**
   * Never throws at the caller — a logger that can break the thing it is
   * observing is worse than no logger. A failed write is counted and the run
   * carries on; the count is what `logStatus` reports.
   */
  fun write(line: String) {
    val out = writer ?: return
    try {
      synchronized(out) { out.write(line); out.write("\n") }
      sampleCount.incrementAndGet()
    } catch (_: Throwable) {
      droppedCount.incrementAndGet()
    }
  }
}

class LogjamSensorsModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw SensorLogException("no context")

  private val sensorManager: SensorManager
    get() = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager

  // -------------------------------------------------------------------------
  // Module surface
  // -------------------------------------------------------------------------

  override fun definition() = ModuleDefinition {
    Name("LogjamSensors")

    /** What this handset can actually contribute, so the UI can say so. */
    Function("capabilities") {
      val sm = sensorManager
      mapOf(
        "accelerometer" to (sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) != null),
        "gyroscope" to (sm.getDefaultSensor(Sensor.TYPE_GYROSCOPE) != null),
        "barometer" to (sm.getDefaultSensor(Sensor.TYPE_PRESSURE) != null),
        "stepCounter" to (sm.getDefaultSensor(Sensor.TYPE_STEP_COUNTER) != null),
        "significantMotion" to
          (sm.getDefaultSensor(Sensor.TYPE_SIGNIFICANT_MOTION) != null),
        "imuFifoEvents" to
          (sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)?.fifoMaxEventCount ?: 0),
      )
    }

    /**
     * @param imuHz 0 disables the IMU entirely — the cheap-channels-only mode,
     *   which is barometer + steps + GNSS status and costs microamps.
     * @param batchSeconds how long the hardware FIFO may hold samples before
     *   waking the CPU. This is the battery knob; 0 means "wake per sample" and
     *   should only ever be used to demonstrate why not to.
     */
    Function("startLogging") { fileUri: String, imuHz: Int, batchSeconds: Int ->
      if (SensorLog.writer != null) throw SensorLogException("already logging")

      val file = File(fileUri.removePrefix("file://"))
      file.parentFile?.mkdirs()
      val out = BufferedWriter(FileWriter(file, true), 1 shl 16)
      out.write(CSV_HEADER); out.write("\n")
      // The one row that ties this log's monotonic clock to wall time, and so
      // to a recorded track. Written first, and only here.
      out.write(
        "anchor,${SystemClock.elapsedRealtimeNanos()},${System.currentTimeMillis()}\n",
      )
      SensorLog.writer = out
      SensorLog.logFile = file
      SensorLog.sampleCount.set(0)
      SensorLog.droppedCount.set(0)
      SensorLog.lastBaroNanos = 0L

      val t = HandlerThread("logjam-sensors").also { it.start() }
      SensorLog.thread = t
      val h = Handler(t.looper)
      SensorLog.handler = h

      val sm = sensorManager
      SensorLog.sensorManager = sm
      if (imuHz > 0) {
        val periodUs = 1_000_000 / imuHz
        val latencyUs = batchSeconds * 1_000_000
        sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)?.let {
          sm.registerListener(SensorLog.imuListener, it, periodUs, latencyUs, h)
        }
        sm.getDefaultSensor(Sensor.TYPE_GYROSCOPE)?.let {
          sm.registerListener(SensorLog.imuListener, it, periodUs, latencyUs, h)
        }
      }
      // 1 Hz is plenty: pressure changes with altitude, and nobody descends a
      // canyon fast enough for a second sample to say anything new.
      sm.getDefaultSensor(Sensor.TYPE_PRESSURE)?.let {
        sm.registerListener(SensorLog.imuListener, it, 1_000_000, batchSeconds * 1_000_000, h)
      }
      // On-change, and its value is cumulative since boot — so a gap in the log
      // still yields the step count across that gap.
      sm.getDefaultSensor(Sensor.TYPE_STEP_COUNTER)?.let {
        sm.registerListener(SensorLog.imuListener, it, 1_000_000, batchSeconds * 1_000_000, h)
      }
      sm.getDefaultSensor(Sensor.TYPE_SIGNIFICANT_MOTION)?.let {
        sm.requestTriggerSensor(SensorLog.motionListener, it)
      }

      // Best-effort: needs ACCESS_FINE_LOCATION, which a recording already
      // holds, but a logger started with location denied must not crash.
      try {
        val lm = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        lm.registerGnssStatusCallback(SensorLog.gnssCallback, h)
      } catch (_: SecurityException) {
        SensorLog.write("# gnss status unavailable: permission")
      }

      file.absolutePath
    }

    Function("stopLogging") {
      val sm = sensorManager
      sm.unregisterListener(SensorLog.imuListener)
      sm.getDefaultSensor(Sensor.TYPE_SIGNIFICANT_MOTION)?.let {
        sm.cancelTriggerSensor(SensorLog.motionListener, it)
      }
      try {
        val lm = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        lm.unregisterGnssStatusCallback(SensorLog.gnssCallback)
      } catch (_: Throwable) {
        // Never registered (permission denied at start) — nothing to undo.
      }

      SensorLog.writer?.let { out -> synchronized(out) { out.flush(); out.close() } }
      SensorLog.writer = null
      SensorLog.thread?.quitSafely()
      SensorLog.thread = null
      SensorLog.handler = null

      val f = SensorLog.logFile
      SensorLog.logFile = null
      mapOf(
        "path" to (f?.absolutePath ?: ""),
        "bytes" to (f?.length() ?: 0L),
        "samples" to SensorLog.sampleCount.get(),
        "dropped" to SensorLog.droppedCount.get(),
      )
    }

    Function("logStatus") {
      val out = SensorLog.writer
      // Flushing on a status read is what makes the byte count mean anything
      // while a run is in progress — a 64 KB buffer is minutes of cheap
      // channels, and a status that reports 0 bytes reads as "it is broken".
      if (out != null) {
        try { synchronized(out) { out.flush() } } catch (_: Throwable) {}
      }
      mapOf(
        "logging" to (out != null),
        "path" to (SensorLog.logFile?.absolutePath ?: ""),
        "bytes" to (SensorLog.logFile?.length() ?: 0L),
        "samples" to SensorLog.sampleCount.get(),
        "dropped" to SensorLog.droppedCount.get(),
      )
    }
  }
}
