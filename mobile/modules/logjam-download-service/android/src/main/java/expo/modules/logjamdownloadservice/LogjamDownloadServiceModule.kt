// The JS handle on DownloadService: show (start, or update what it says) and
// stop. See DownloadService.kt for what the service is for and what it costs.
package expo.modules.logjamdownloadservice

import android.content.Intent
import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class LogjamDownloadServiceModule : Module() {
  /** A start has been sent and no stop since, whether or not it has landed yet. */
  private var started = false
  private var timersTask: Int? = null

  // React Native stops delivering JS timers while the activity is paused,
  // unless a headless task is running. The tile loop's rate limiter, timeouts
  // and backoff are all timers, so without this the service keeps the process
  // alive and the download still stands still behind another app. The task
  // itself does nothing (src/LogjamDownloadServiceModule.ts).
  private fun keepTimers(on: Boolean) {
    val context = appContext.reactContext as? ReactContext ?: return
    UiThreadUtil.runOnUiThread {
      try {
        val tasks = HeadlessJsTaskContext.getInstance(context)
        if (on && timersTask == null) {
          timersTask = tasks.startTask(
            HeadlessJsTaskConfig(TIMERS_TASK, Arguments.createMap(), 0, true),
          )
        } else if (!on) {
          timersTask?.let { tasks.finishTask(it) }
          timersTask = null
        }
      } catch (e: Exception) {
        // The React instance is going away; so is the download.
      }
    }
  }

  override fun definition() = ModuleDefinition {
    Name("LogjamDownloadService")

    Function("show") { title: String, text: String, percent: Int ->
      val context = appContext.reactContext ?: return@Function
      val running = DownloadService.instance
      if (started && running != null) {
        running.update(title, text, percent)
        return@Function
      }
      val intent = Intent(context, DownloadService::class.java)
        .putExtra(DownloadService.EXTRA_TITLE, title)
        .putExtra(DownloadService.EXTRA_TEXT, text)
        .putExtra(DownloadService.EXTRA_PERCENT, percent)
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          context.startForegroundService(intent)
        } else {
          context.startService(intent)
        }
        started = true
        keepTimers(true)
      } catch (e: Exception) {
        // Android refuses a foreground-service start from the background. The
        // download still runs for as long as the process does.
      }
    }

    Function("stop") {
      val context = appContext.reactContext
      if (context != null && started) {
        started = false
        keepTimers(false)
        // Through onStartCommand rather than stopService(): a stop that beats the
        // start to the service would otherwise skip startForeground() and crash.
        try {
          context.startService(
            Intent(context, DownloadService::class.java).setAction(DownloadService.ACTION_STOP),
          )
        } catch (e: Exception) {
          context.stopService(Intent(context, DownloadService::class.java))
        }
      }
    }
  }

  companion object {
    const val TIMERS_TASK = "LogjamDownloadTimers"
  }
}
