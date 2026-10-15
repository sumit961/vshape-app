package app.vshape.tracker;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Holds the ongoing "active workout" notification alive as a foreground
 * service. Uses the platform "health" foreground-service type (not
 * mediaPlayback) because this is a fitness-tracking notification, not
 * simulated media playback.
 *
 * The elapsed-time and rest-countdown numbers are driven by the OS's own
 * Chronometer view (setUsesChronometer / setChronometerCountDown against a
 * fixed deadline), so the notification never needs to be rebuilt once a
 * second from JS - only on meaningful state changes (start/pause/resume/
 * finish, a new set, rest starting or ending).
 */
public class WorkoutForegroundService extends Service {
    static final String ACTION_SHOW = "app.vshape.tracker.notif.SHOW";
    static final String ACTION_HIDE = "app.vshape.tracker.notif.HIDE";
    static final String EXTRA_STATE = "state";
    private static final String CHANNEL_ID = "workout_active";
    private static final int NOTIF_ID = 4201;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_HIDE.equals(intent.getAction())) {
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }
        String stateJson = intent != null ? intent.getStringExtra(EXTRA_STATE) : null;
        startInForeground(buildNotification(stateJson));
        return START_STICKY;
    }

    private void startInForeground(Notification n) {
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH);
        } else if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIF_ID, n, 0);
        } else {
            startForeground(NOTIF_ID, n);
        }
    }

    private Notification buildNotification(String stateJson) {
        ensureChannel();
        JSONObject s = new JSONObject();
        if (stateJson != null) {
            try { s = new JSONObject(stateJson); } catch (JSONException ignored) {}
        }

        String title = s.optString("title", "Workout");
        boolean paused = "paused".equals(s.optString("status", "active"));
        String exercise = s.optString("exerciseName", "");
        int setsDone = s.optInt("setsDone", 0);
        int setsTotal = s.optInt("setsTotal", 0);
        long startedAt = s.optLong("startedAtEpochMs", System.currentTimeMillis());
        long pausedMs = s.optLong("pausedMs", 0L);
        long elapsedMs = s.optLong("elapsedMs", 0L);
        boolean restActive = s.optBoolean("restActive", false);
        boolean restPaused = s.optBoolean("restPaused", false);
        long restDeadline = s.optLong("restDeadlineEpochMs", 0L);
        String sessionId = s.optString("sessionId", "");

        String sub = (exercise.isEmpty() ? "" : exercise + " · ") + setsDone + "/" + setsTotal + " sets";
        boolean showRestCountdown = restActive && !restPaused && restDeadline > 0;

        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_WORKOUT)
            .setContentIntent(openAppIntent());

        if (showRestCountdown) {
            b.setUsesChronometer(true).setChronometerCountDown(true).setWhen(restDeadline);
            b.setContentText("Rest · " + sub);
        } else if (!paused) {
            b.setUsesChronometer(true).setChronometerCountDown(false).setWhen(startedAt + pausedMs);
            b.setContentText(restActive ? "Rest paused · " + sub : sub);
        } else {
            b.setUsesChronometer(false);
            b.setContentText("Paused · " + formatClock(elapsedMs) + " · " + sub);
        }

        b.addAction(
            0,
            paused ? "Resume" : "Pause",
            actionIntent(paused ? WorkoutActionReceiver.ACTION_RESUME : WorkoutActionReceiver.ACTION_PAUSE, sessionId, 10)
        );
        if (showRestCountdown) {
            b.addAction(0, "Skip rest", actionIntent(WorkoutActionReceiver.ACTION_SKIP_REST, sessionId, 11));
        }

        return b.build();
    }

    private static String formatClock(long ms) {
        long totalSec = Math.max(0, ms / 1000);
        long m = totalSec / 60, sec = totalSec % 60;
        return m + ":" + (sec < 10 ? "0" + sec : String.valueOf(sec));
    }

    private PendingIntent openAppIntent() {
        Intent i = new Intent(this, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        return PendingIntent.getActivity(this, 20, i, flags);
    }

    private PendingIntent actionIntent(String action, String sessionId, int requestCode) {
        Intent i = new Intent(action);
        i.setPackage(getPackageName());
        i.putExtra(WorkoutActionReceiver.EXTRA_SESSION_ID, sessionId);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        return PendingIntent.getBroadcast(this, requestCode, i, flags);
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null && nm.getNotificationChannel(CHANNEL_ID) == null) {
                NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Active workout", NotificationManager.IMPORTANCE_LOW);
                ch.setDescription("Shows your current workout, elapsed time and rest timer while it is active.");
                ch.setShowBadge(false);
                nm.createNotificationChannel(ch);
            }
        }
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
