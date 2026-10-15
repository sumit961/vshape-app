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
import android.util.Log;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Holds the ongoing "active workout" notification alive as a foreground
 * service.
 *
 * Foreground-service type: Android 14 added a "health" FGS type, but using it
 * requires the app to already hold a sensor/health runtime permission
 * (BODY_SENSORS, ACTIVITY_RECOGNITION, READ_HEART_RATE, etc. - see Android's
 * FGS-types docs). This app only reads Health Connect data through its own
 * permission namespace, not those raw sensor permissions, and adding one
 * purely to qualify would be an unrelated permission added just to bypass a
 * restriction. So this uses the "specialUse" catch-all type instead (see the
 * matching manifest <property> declaration), which fits a user-visible,
 * user-initiated workout-status notification with no special data access.
 * It is not MediaSession/mediaPlayback either, since this isn't audio/media.
 *
 * The elapsed-time and rest-countdown numbers are driven by the OS's own
 * Chronometer view (setUsesChronometer / setChronometerCountDown against a
 * fixed deadline), so the notification never needs to be rebuilt once a
 * second from JS - only on meaningful state changes (start/pause/resume/
 * finish, a new set, rest starting/pausing/resuming/ending).
 */
public class WorkoutForegroundService extends Service {
    static final String ACTION_SHOW = "app.vshape.tracker.notif.SHOW";
    static final String ACTION_HIDE = "app.vshape.tracker.notif.HIDE";
    static final String ACTION_MARK_PENDING = "app.vshape.tracker.notif.MARK_PENDING";
    static final String EXTRA_STATE = "state";
    static final String EXTRA_PENDING_TYPE = "pendingType";
    private static final String TAG = "WorkoutFgsService";
    private static final String CHANNEL_ID = "workout_active";
    private static final int NOTIF_ID = 4201;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // This service is only ever driven explicitly, by show()/hide() (JS state
        // changes) or a notification-button tap - it never needs the OS to
        // resurrect it on its own after being killed, and doing so would just
        // risk showing a stale/ghost notification with no real data behind it.
        // START_STICKY is deliberately not used anywhere in this service.
        if (intent == null) return START_NOT_STICKY;
        String action = intent.getAction();

        if (ACTION_HIDE.equals(action)) {
            try { stopForeground(true); } catch (Exception ignored) {}
            // Clear the cached state too, so a notification-action tap that was
            // already in flight when the workout finished can't resurrect a
            // "ghost" notification via ACTION_MARK_PENDING below.
            ActionQueue.saveLastState(getApplicationContext(), null);
            stopSelf();
            return START_NOT_STICKY;
        }

        if (ACTION_MARK_PENDING.equals(action)) {
            // Instant, honest feedback for a notification-button tap: redraw the
            // last known state with a "pending" hint, without claiming the
            // action has actually been applied yet - that only happens once
            // core.js reconciles it and calls show() again with real state.
            // If there is no cached state (e.g. the workout was just finished),
            // there is nothing legitimate to show, so this is a deliberate no-op.
            String lastState = ActionQueue.loadLastState(getApplicationContext());
            if (lastState != null) {
                startInForeground(buildNotification(lastState, intent.getStringExtra(EXTRA_PENDING_TYPE)));
            }
            return START_NOT_STICKY;
        }

        String stateJson = intent.getStringExtra(EXTRA_STATE);
        if (stateJson != null) ActionQueue.saveLastState(getApplicationContext(), stateJson);
        startInForeground(buildNotification(stateJson, null));
        return START_NOT_STICKY;
    }

    private void startInForeground(Notification n) {
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            } else if (Build.VERSION.SDK_INT >= 29) {
                startForeground(NOTIF_ID, n, 0);
            } else {
                startForeground(NOTIF_ID, n);
            }
        } catch (Exception e) {
            // A denied/rescinded notification permission, a platform foreground-service
            // start restriction, or anything else that can throw here must not crash the
            // app - the workout still tracks fine without the notification. Record it so
            // the JS side can tell the user once, then shut this attempt down cleanly.
            Log.w(TAG, "Could not start the workout foreground service", e);
            ActionQueue.recordError(getApplicationContext(), "could not show the notification (" + e.getClass().getSimpleName() + ")");
            stopSelf();
        }
    }

    private Notification buildNotification(String stateJson, String pendingType) {
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

        String contentText;
        if (showRestCountdown) {
            b.setUsesChronometer(true).setChronometerCountDown(true).setWhen(restDeadline);
            contentText = "Rest · " + sub;
        } else if (!paused) {
            b.setUsesChronometer(true).setChronometerCountDown(false).setWhen(startedAt + pausedMs);
            contentText = restActive ? "Rest paused · " + sub : sub;
        } else {
            b.setUsesChronometer(false);
            contentText = "Paused · " + formatClock(elapsedMs) + " · " + sub;
        }
        if (pendingType != null) contentText = contentText + " · Updating…";
        b.setContentText(contentText);

        boolean pausePending = "pause".equals(pendingType) || "resume".equals(pendingType);
        b.addAction(
            0,
            pausePending ? "…" : (paused ? "Resume" : "Pause"),
            actionIntent(paused ? WorkoutActionReceiver.ACTION_RESUME : WorkoutActionReceiver.ACTION_PAUSE, sessionId, 10)
        );
        if (showRestCountdown || "skip-rest".equals(pendingType)) {
            boolean skipPending = "skip-rest".equals(pendingType);
            b.addAction(0, skipPending ? "…" : "Skip rest", actionIntent(WorkoutActionReceiver.ACTION_SKIP_REST, sessionId, 11));
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
        // Only ever created once, and never recreated with different settings -
        // if the user has muted/changed importance for this channel, that
        // choice is respected and left alone.
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
