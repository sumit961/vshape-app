package app.vshape.tracker;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Holds the ongoing "active workout" notification alive as a foreground service, AND (Phase
 * 2B.3) acts as a quick-logging controller that can validate, commit and advance through a
 * workout entirely on its own, without the WebView running at all.
 *
 * Foreground-service type: see the "specialUse" rationale this class already used before 2B.3 -
 * unchanged.
 *
 * Two render paths:
 *  - buildPausedNotification(): the workout itself is paused. core.js is the only thing that
 *    tracks session.pausedMs, so this still just reads whatever JS last pushed and shows an
 *    "Updating…" hint for a pending Resume tap, exactly as before 2B.3.
 *  - buildActiveNotification(): the workout is active. Rather than trusting the possibly-stale
 *    exId/setIndex/suggestedW JS last pushed directly, this recomputes "what set is pending,
 *    is a rest running" from the merged view of JS's last committedLog, this device's own
 *    nativeCommits (sets committed here since that push - see ActionQueue/WorkoutLogic) and its
 *    own nativeRest deadline. That merged view is what lets Log Set/Skip Rest/Pause-Resume
 *    Rest/Finish all be decided here immediately, and is corrected back to whatever JS actually
 *    reconciled the next time it pushes a fresh state (ActionQueue.saveLastState prunes
 *    nativeCommits against it; onStartCommand's ACTION_SHOW handling clears nativeRest).
 */
public class WorkoutForegroundService extends Service {
    static final String ACTION_SHOW = "app.vshape.tracker.notif.SHOW";
    static final String ACTION_HIDE = "app.vshape.tracker.notif.HIDE";
    static final String ACTION_MARK_PENDING = "app.vshape.tracker.notif.MARK_PENDING";
    static final String ACTION_SHOW_PROJECTION = "app.vshape.tracker.notif.SHOW_PROJECTION";
    static final String EXTRA_STATE = "state";
    static final String EXTRA_PENDING_TYPE = "pendingType";
    private static final String TAG = "WorkoutFgsService";
    private static final String CHANNEL_ID = "workout_active";
    private static final int NOTIF_ID = 4201;

    private final Handler restHandler = new Handler(Looper.getMainLooper());
    private Runnable restExpiryRunnable;

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
            cancelRestExpiry();
            try { stopForeground(true); } catch (Exception ignored) {}
            // Clear the cached state too, so a notification-action tap that was
            // already in flight when the workout finished can't resurrect a
            // "ghost" notification via ACTION_MARK_PENDING below.
            ActionQueue.saveLastState(getApplicationContext(), null);
            ActionQueue.clearNativeRest(getApplicationContext());
            stopSelf();
            return START_NOT_STICKY;
        }

        if (ACTION_MARK_PENDING.equals(action)) {
            // Instant, honest feedback for a notification-button tap this service cannot fully
            // decide itself (Pause/Resume workout, or a native commit write that failed):
            // redraw the last known state with a "pending" hint, without claiming the action
            // has actually been applied yet. If there is no cached state (e.g. the workout was
            // just finished), there is nothing legitimate to show, so this is a no-op.
            String lastState = ActionQueue.loadLastState(getApplicationContext());
            if (lastState != null) {
                render(lastState, intent.getStringExtra(EXTRA_PENDING_TYPE));
            }
            return START_NOT_STICKY;
        }

        if (ACTION_SHOW_PROJECTION.equals(action)) {
            // The authoritative path for everything this service CAN fully decide itself (Log
            // Set, Skip Rest, Pause/Resume Rest, a weight adjustment): recompute purely from
            // durable cached state (lastState + nativeCommits + nativeRest + pendingAdjust), no
            // "Updating…" hint, because there is nothing left pending - it already happened.
            String lastState = ActionQueue.loadLastState(getApplicationContext());
            if (lastState != null) render(lastState, null);
            return START_NOT_STICKY;
        }

        String stateJson = intent.getStringExtra(EXTRA_STATE);
        if (stateJson != null) {
            ActionQueue.saveLastState(getApplicationContext(), stateJson);
            syncNativeRestFromJsState(getApplicationContext(), stateJson);
        }
        render(stateJson, null);
        return START_NOT_STICKY;
    }

    /**
     * Fixed bug: a fresh push from JS used to unconditionally CLEAR nativeRest here, on the
     * reasoning that JS is "the most current truth" and a subsequent native action would
     * re-establish it if needed. That reasoning only held for rest started BY a native
     * action (Log Set tapped on the notification itself). It was wrong for rest started from
     * the IN-APP UI: buildActiveNotification() decides "is resting" purely from nativeRest,
     * never from the JS payload's own restActive/restDeadlineEpochMs/restPaused fields - so a
     * set logged inside the app would start session.rest correctly in JS, push it here, and
     * this method would immediately throw that information away, permanently hiding the rest
     * countdown from the notification (and silently breaking the native Pause/Resume/Skip
     * rest button handlers too, since those also only read nativeRest).
     *
     * Fix: ESTABLISH nativeRest from whatever JS actually sent, rather than always clearing
     * it. This makes the notification's rest state correct regardless of whether rest was
     * started by the app or by the notification itself, and lets the proactive rest-expiry
     * Handler (scheduleRestExpiryIfNeeded) fire for app-started rests too. Both sides use the
     * same wall-clock epoch-millisecond basis throughout (JS's Date.now() and Java's
     * System.currentTimeMillis()), so the stored deadline/pausedRemainingMs values need no
     * conversion between JS and native - they are already one consistent time base. The
     * genuinely different time base is Android's own Chronometer widget, which this class's
     * setWhen()/setUsesChronometer(true) call already relies on: Android itself converts that
     * wall-clock "when" into its internally-used elapsedRealtime-based chronometer stopwatch
     * base (base = when + (elapsedRealtime() - currentTimeMillis())) every time the
     * notification is rebuilt, which is standard, documented NotificationCompat/Notification
     * behavior - not something this app needs to (or should) do itself.
     */
    private void syncNativeRestFromJsState(Context ctx, String stateJson) {
        JSONObject s;
        try { s = new JSONObject(stateJson); } catch (Exception e) { return; }
        WorkoutLogic.NativeRestSync sync = WorkoutLogic.syncRestFromState(s);
        if (sync == null) { ActionQueue.clearNativeRest(ctx); return; }
        ActionQueue.saveNativeRest(ctx, sync.sessionId, sync.deadlineEpochMs, sync.pausedRemainingMs, sync.exId, sync.exName);
    }

    private void render(String stateJson, String pendingType) {
        startInForeground(buildNotification(stateJson, pendingType));
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
        boolean paused = "paused".equals(s.optString("status", "active"));
        return paused ? buildPausedNotification(s, pendingType) : buildActiveNotification(s, pendingType);
    }

    private Notification buildPausedNotification(JSONObject s, String pendingType) {
        String title = s.optString("title", "Workout");
        String sessionId = s.optString("sessionId", "");
        long elapsedMs = s.optLong("elapsedMs", 0L);
        int setsDone = s.optInt("setsDone", 0), setsTotal = s.optInt("setsTotal", 0);
        String exercise = s.optString("exerciseName", "");
        String sub = (exercise.isEmpty() ? "" : exercise + " · ") + setsDone + "/" + setsTotal + " sets";

        NotificationCompat.Builder b = baseBuilder(title);
        b.setUsesChronometer(false);
        String contentText = "Paused · " + formatClock(elapsedMs) + " · " + sub;
        if ("resume".equals(pendingType)) contentText = contentText + " · Updating…";
        b.setContentText(contentText);
        b.addAction(0, "resume".equals(pendingType) ? "…" : "Resume workout", actionIntent(WorkoutActionReceiver.ACTION_RESUME, sessionId, 10));
        return b.build();
    }

    /**
     * Button layout is deliberately different per state, because a plain Android notification
     * only reliably supports about 3 action buttons (there is no OS-guaranteed "expanded, more
     * actions" mode for a stock notification the way a custom RemoteViews layout could offer -
     * and this intentionally does NOT use a custom RemoteViews layout: its text/background
     * colors are not guaranteed to match the system's light/dark notification theme the way
     * NotificationCompat's own views are, which is exactly the kind of per-OEM rendering risk
     * this app has no way to verify without a real device on real Android skins):
     *   ready            -> [ -increment, Log Set, +increment ]  (reps are not adjustable here)
     *   resting          -> [ Skip rest, Pause rest, Pause workout ]
     *   rest_paused      -> [ Skip rest, Resume rest, Pause workout ]
     *   exercise_complete-> [ Finish workout, Pause workout ]
     */
    private Notification buildActiveNotification(JSONObject s, String pendingType) {
        String title = s.optString("title", "Workout");
        String sessionId = s.optString("sessionId", "");
        long startedAt = s.optLong("startedAtEpochMs", System.currentTimeMillis());
        long pausedMs = s.optLong("pausedMs", 0L);
        JSONArray exSnapshot = s.optJSONArray("exSnapshot");
        JSONObject committedLogFromJs = s.optJSONObject("committedLog");
        JSONArray suggestions = s.optJSONArray("suggestions");

        JSONArray nativeCommits = ActionQueue.loadNativeCommits(getApplicationContext(), sessionId);
        JSONObject mergedLog = WorkoutLogic.mergeLog(committedLogFromJs, nativeCommits);
        int[] doneTotal = WorkoutLogic.setsDoneTotal(exSnapshot, mergedLog);

        JSONObject nativeRest = ActionQueue.loadNativeRest(getApplicationContext(), sessionId);
        boolean restExpired = nativeRest != null && !nativeRest.has("pausedRemainingMs") && nativeRest.optLong("deadline", 0) <= System.currentTimeMillis();
        if (restExpired) {
            // The Handler-based callback (scheduleRestExpiryIfNeeded) is the proactive path;
            // this is the defensive, always-correct fallback for whenever this is rebuilt for
            // any other reason after the deadline has already passed (e.g. the service process
            // was recreated and the Handler callback never survived) - never show a stale,
            // already-finished countdown.
            ActionQueue.clearNativeRest(getApplicationContext());
            nativeRest = null;
        }
        boolean resting = nativeRest != null && !nativeRest.has("pausedRemainingMs");
        boolean restPausedNow = nativeRest != null && nativeRest.has("pausedRemainingMs");

        NotificationCompat.Builder b = baseBuilder(title);

        if (resting || restPausedNow) {
            String exName = nativeRest.optString("exName", "");
            String sub = (exName.isEmpty() ? "" : exName + " · ") + doneTotal[0] + "/" + doneTotal[1] + " sets";
            if (resting) {
                b.setUsesChronometer(true).setChronometerCountDown(true).setWhen(nativeRest.optLong("deadline", 0));
                setContentText(b, "Rest · " + sub, pendingType);
                scheduleRestExpiryIfNeeded(nativeRest.optLong("deadline", 0));
            } else {
                b.setUsesChronometer(false);
                setContentText(b, "Rest paused · " + formatClock(nativeRest.optLong("pausedRemainingMs", 0)) + " left · " + sub, pendingType);
                cancelRestExpiry();
            }
            boolean skipPending = "skip-rest".equals(pendingType);
            boolean restTogglePending = "pause-rest".equals(pendingType) || "resume-rest".equals(pendingType);
            boolean pausePending = "pause".equals(pendingType);
            b.addAction(0, skipPending ? "…" : "Skip rest", actionIntent(WorkoutActionReceiver.ACTION_SKIP_REST, sessionId, 11));
            b.addAction(0, restTogglePending ? "…" : (restPausedNow ? "Resume rest" : "Pause rest"),
                actionIntent(restPausedNow ? WorkoutActionReceiver.ACTION_RESUME_REST : WorkoutActionReceiver.ACTION_PAUSE_REST, sessionId, 12));
            b.addAction(0, pausePending ? "…" : "Pause workout", actionIntent(WorkoutActionReceiver.ACTION_PAUSE, sessionId, 10));
            return b.build();
        }

        cancelRestExpiry();
        JSONObject pending = WorkoutLogic.nextPendingSet(exSnapshot, mergedLog);
        if (pending == null) {
            String lastExName = exSnapshot != null && exSnapshot.length() > 0 ? exSnapshot.optJSONObject(exSnapshot.length() - 1).optString("name", "") : "";
            String sub = (lastExName.isEmpty() ? "" : lastExName + " · ") + doneTotal[0] + "/" + doneTotal[1] + " sets";
            b.setUsesChronometer(true).setChronometerCountDown(false).setWhen(startedAt + pausedMs);
            setContentText(b, "Every set logged · " + sub + " · Ready to finish", pendingType);
            boolean finishPending = "finish".equals(pendingType);
            boolean pausePending = "pause".equals(pendingType);
            b.addAction(0, finishPending ? "…" : "Finish workout", finishIntent(sessionId));
            b.addAction(0, pausePending ? "…" : "Pause workout", actionIntent(WorkoutActionReceiver.ACTION_PAUSE, sessionId, 10));
            return b.build();
        }

        String exId = pending.optString("exId", null);
        int setIndex = pending.optInt("setIndex", 0);
        JSONObject ex = pending.optJSONObject("ex");
        String exName = ex != null ? ex.optString("name", "") : "";
        int exSets = ex != null ? ex.optInt("sets", 0) : 0;
        boolean isBodyweight = ex != null && ex.optBoolean("bw", false);
        boolean isTimed = ex != null && ex.optBoolean("timed", false);
        double weightInc = ex != null ? ex.optDouble("inc", 2.5) : 2.5;
        double suggestedW = WorkoutLogic.suggestedW(suggestions, exId);
        int suggestedR = WorkoutLogic.suggestedR(suggestions, exId, setIndex);
        int exDone = WorkoutLogic.exerciseSetsDone(mergedLog, exId);

        JSONObject adj = exId != null ? ActionQueue.loadPendingAdjust(getApplicationContext(), s.optString("sessionId", ""), exId, setIndex) : null;
        double actualW = adj != null ? adj.optDouble("w", suggestedW) : suggestedW;

        b.setUsesChronometer(true).setChronometerCountDown(false).setWhen(startedAt + pausedMs);
        String loadTxt = isBodyweight && actualW == 0 ? "bodyweight" : formatWeight(actualW) + "kg";
        String contentText = exName + " · set " + (setIndex + 1) + "/" + exSets + " · " + loadTxt + " x " + suggestedR + (isTimed ? "s" : "")
            + " · " + exDone + "/" + exSets + " this exercise, " + doneTotal[0] + "/" + doneTotal[1] + " total";
        setContentText(b, contentText, pendingType);

        boolean logPending = "logset".equals(pendingType);
        b.addAction(0, "- " + formatWeight(weightInc), adjustWeightIntent(false, sessionId, exId, setIndex, suggestedW, weightInc));
        b.addAction(0, logPending ? "…" : "Log set", logSetIntent(sessionId, exId, setIndex, suggestedW, suggestedR));
        b.addAction(0, "+ " + formatWeight(weightInc), adjustWeightIntent(true, sessionId, exId, setIndex, suggestedW, weightInc));
        return b.build();
    }

    private void setContentText(NotificationCompat.Builder b, String text, String pendingType) {
        if (pendingType != null) text = text + " · Updating…";
        b.setContentText(text);
    }

    private NotificationCompat.Builder baseBuilder(String title) {
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_WORKOUT)
            .setContentIntent(openAppIntent());
    }

    /**
     * Best-effort proactive transition the moment rest hits zero, so the notification
     * advances to the next pending set without any user interaction at all - this is what
     * "automatically show the next pending set/exercise when rest completes" means while
     * genuinely backgrounded. A Handler survives exactly as long as this Service instance
     * does; Android does not impose Doze/background-execution limits on an active foreground
     * service's own callbacks, but some OEMs (Samsung included) are known to aggressively kill
     * foreground services under battery-saver modes regardless of what Android's own API
     * guarantees say - not verified on a real device. If the callback never fires for that or
     * any other reason, buildActiveNotification()'s own deadline check above still corrects the
     * display the next time anything rebuilds the notification, just not proactively.
     */
    private void scheduleRestExpiryIfNeeded(long deadlineEpochMs) {
        if (restExpiryRunnable != null) return; // already scheduled for this same rest period
        long delay = deadlineEpochMs - System.currentTimeMillis();
        if (delay <= 0) { onRestExpired(); return; }
        restExpiryRunnable = this::onRestExpired;
        restHandler.postDelayed(restExpiryRunnable, delay);
    }

    private void cancelRestExpiry() {
        if (restExpiryRunnable != null) {
            restHandler.removeCallbacks(restExpiryRunnable);
            restExpiryRunnable = null;
        }
    }

    private void onRestExpired() {
        restExpiryRunnable = null;
        String lastState = ActionQueue.loadLastState(getApplicationContext());
        if (lastState == null) return; // workout no longer active, nothing to do
        JSONObject s;
        try { s = new JSONObject(lastState); } catch (Exception e) { return; }
        String sessionId = s.optString("sessionId", null);
        // Rest ending logs nothing and changes no set data - it is purely a notification-state
        // transition, so there is nothing that needs core.js's exclusive log-mutating path. A
        // 'skip-rest' is still queued durably so core.js's own session.rest is cleared once it
        // next reconciles, keeping both sides eventually consistent.
        ActionQueue.clearNativeRest(getApplicationContext());
        ActionQueue.commitSimple(getApplicationContext(), "skip-rest", sessionId);
        render(lastState, null);
    }

    @Override
    public void onDestroy() {
        cancelRestExpiry();
        super.onDestroy();
    }

    private static String formatWeight(double w) {
        return (w == Math.floor(w)) ? String.valueOf((long) w) : String.valueOf(Math.round(w * 100) / 100.0);
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
        return broadcastPendingIntent(requestCode, i);
    }

    private PendingIntent logSetIntent(String sessionId, String exId, int setIndex, double suggestedW, int suggestedR) {
        Intent i = new Intent(WorkoutActionReceiver.ACTION_LOG_SET);
        i.setPackage(getPackageName());
        i.putExtra(WorkoutActionReceiver.EXTRA_SESSION_ID, sessionId);
        i.putExtra(WorkoutActionReceiver.EXTRA_EX_ID, exId);
        i.putExtra(WorkoutActionReceiver.EXTRA_SET_INDEX, setIndex);
        i.putExtra(WorkoutActionReceiver.EXTRA_SUGGESTED_W, suggestedW);
        i.putExtra(WorkoutActionReceiver.EXTRA_SUGGESTED_R, suggestedR);
        return broadcastPendingIntent(13, i);
    }

    private PendingIntent finishIntent(String sessionId) {
        return actionIntent(WorkoutActionReceiver.ACTION_FINISH, sessionId, 16);
    }

    private PendingIntent adjustWeightIntent(boolean up, String sessionId, String exId, int setIndex, double suggestedW, double inc) {
        Intent i = new Intent(up ? WorkoutActionReceiver.ACTION_ADJUST_WEIGHT_UP : WorkoutActionReceiver.ACTION_ADJUST_WEIGHT_DOWN);
        i.setPackage(getPackageName());
        i.putExtra(WorkoutActionReceiver.EXTRA_SESSION_ID, sessionId);
        i.putExtra(WorkoutActionReceiver.EXTRA_EX_ID, exId);
        i.putExtra(WorkoutActionReceiver.EXTRA_SET_INDEX, setIndex);
        i.putExtra(WorkoutActionReceiver.EXTRA_SUGGESTED_W, suggestedW);
        i.putExtra(WorkoutActionReceiver.EXTRA_WEIGHT_INC, inc);
        return broadcastPendingIntent(up ? 15 : 14, i);
    }

    private PendingIntent broadcastPendingIntent(int requestCode, Intent i) {
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
