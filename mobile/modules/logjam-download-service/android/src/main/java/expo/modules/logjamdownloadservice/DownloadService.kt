// Keeps the process running while a map download the user started is in
// flight, with a notification that says so.
//
// WHY A SERVICE AT ALL: Android 14+ freezes a cached process about 10 s after
// the app leaves the screen, JS timers and fetches included, so a tile loop in
// JS stops shortly after the user switches apps or the screen locks. A
// foreground service is what keeps the process out of the cached state. It
// does none of the downloading: the queue in src/offline/regionDownloadQueue.ts
// does, and tells this when to start, what to show and when to stop.
//
// BATTERY: the service by itself costs a notification. The CPU wake lock is
// the part that costs, so it is never held open-ended: every progress update
// re-arms a short timeout, and a download that stops reporting (paused, or
// waiting for a connection) lets the CPU sleep again within WAKE_MS. The JS
// side bounds how long it waits and how often it retries behind another app
// (docs/decisions/0013).
//
// PRIVACY: the notification carries a count and a percentage. Never an area
// name or anything derived from a bbox: it is readable on the lock screen.
package expo.modules.logjamdownloadservice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager

class DownloadService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // ALWAYS, and first, on the stop path too: startForegroundService() obliges
    // the service to call startForeground() within seconds or the app is
    // killed, and a stop can arrive before the start has been delivered.
    val notification = buildNotification(
      this,
      intent?.getStringExtra(EXTRA_TITLE) ?: "",
      intent?.getStringExtra(EXTRA_TEXT) ?: "",
      intent?.getIntExtra(EXTRA_PERCENT, -1) ?: -1,
    )
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(
          NOTIFICATION_ID,
          notification,
          ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
        )
      } else {
        startForeground(NOTIFICATION_ID, notification)
      }
    } catch (e: Exception) {
      // Started from the background, or the dataSync allowance for the day is
      // spent. The download carries on unprotected; nothing to tell the user.
      stopSelf()
      return START_NOT_STICKY
    }
    if (intent == null || intent.action == ACTION_STOP) {
      stopForeground(STOP_FOREGROUND_REMOVE)
      stopSelf()
      return START_NOT_STICKY
    }
    instance = this
    holdCpu()
    // NOT_STICKY: if the process dies the JS queue died with it, and a service
    // restarted on its own would hold a notification over nothing.
    return START_NOT_STICKY
  }

  fun update(title: String, text: String, percent: Int) {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.notify(NOTIFICATION_ID, buildNotification(this, title, text, percent))
    holdCpu()
  }

  /** Re-arm the CPU lock. Not reference counted, so each call replaces the timeout. */
  private fun holdCpu() {
    val lock = wakeLock ?: (getSystemService(Context.POWER_SERVICE) as PowerManager)
      .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "logjam:region-download")
      .also {
        it.setReferenceCounted(false)
        wakeLock = it
      }
    lock.acquire(WAKE_MS)
  }

  // Android 15: a dataSync service gets 6 h in 24 h, then this, then a crash if
  // it is still in the foreground a few seconds later.
  override fun onTimeout(startId: Int, fgsType: Int) {
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  override fun onDestroy() {
    if (instance === this) instance = null
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
    super.onDestroy()
  }

  companion object {
    const val ACTION_STOP = "expo.modules.logjamdownloadservice.STOP"
    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"
    const val EXTRA_PERCENT = "percent"
    private const val CHANNEL_ID = "region-downloads"
    private const val NOTIFICATION_ID = 0x10D0
    /** Longer than one tile's whole retry ladder (~90 s), short enough to be cheap. */
    private const val WAKE_MS = 3 * 60 * 1000L

    @Volatile
    var instance: DownloadService? = null

    fun buildNotification(
      context: Context,
      title: String,
      text: String,
      percent: Int,
    ): Notification {
      val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val manager =
          context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        // LOW: no sound, no heads-up. Creating an existing channel is a no-op.
        manager.createNotificationChannel(
          NotificationChannel(CHANNEL_ID, "Map downloads", NotificationManager.IMPORTANCE_LOW),
        )
        Notification.Builder(context, CHANNEL_ID)
      } else {
        @Suppress("DEPRECATION")
        Notification.Builder(context)
      }
      // expo-notifications' config plugin writes this drawable; the launcher
      // icon is the fallback if that ever changes.
      val icon = context.resources
        .getIdentifier("notification_icon", "drawable", context.packageName)
        .takeIf { it != 0 } ?: context.applicationInfo.icon
      builder
        .setSmallIcon(icon)
        .setContentTitle(title)
        .setContentText(text)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
      if (percent >= 0) builder.setProgress(100, percent.coerceAtMost(100), false)
      context.packageManager.getLaunchIntentForPackage(context.packageName)?.let { launch ->
        builder.setContentIntent(
          PendingIntent.getActivity(
            context,
            0,
            launch,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
          ),
        )
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
      }
      return builder.build()
    }
  }
}
