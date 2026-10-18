package app.vshape.tracker;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Handles a tap on a notification action button. This must work whether the app/WebView is
 * alive or not.
 *
 * Phase 2B.3 change: Log Set, Skip Rest, Pause/Resume Rest and Finish are now decided HERE,
 * natively, immediately and durably (see ActionQueue.commitLogSet/commitSimple, both using a
 * synchronous SharedPreferences commit()) - the notification reflects the real outcome right
 * away, not a hopeful "Updating…" placeholder waiting for core.js. core.js still independently
 * re-validates and is still the ONLY thing that ever writes to session.log/localStorage - this
 * receiver's native validation (WorkoutLogic.isValidSet, the duplicate-index check) is a
 * second, defense-in-depth check, not a replacement for core.js's. Pause/Resume of the WHOLE
 * WORKOUT are the one remaining exception: they affect elapsed-time bookkeeping
 * (session.pausedMs) that only core.js tracks, so those two still just queue-and-wait, exactly
 * as in 2A.1/2B.2.
 */
public class WorkoutActionReceiver extends BroadcastReceiver {
    static final String ACTION_PAUSE = "app.vshape.tracker.action.PAUSE";
    static final String ACTION_RESUME = "app.vshape.tracker.action.RESUME";
    static final String ACTION_SKIP_REST = "app.vshape.tracker.action.SKIP_REST";
    static final String ACTION_PAUSE_REST = "app.vshape.tracker.action.PAUSE_REST";
    static final String ACTION_RESUME_REST = "app.vshape.tracker.action.RESUME_REST";
    static final String ACTION_LOG_SET = "app.vshape.tracker.action.LOG_SET";
    static final String ACTION_FINISH = "app.vshape.tracker.action.FINISH";
    static final String ACTION_ADJUST_WEIGHT_UP = "app.vshape.tracker.action.ADJUST_WEIGHT_UP";
    static final String ACTION_ADJUST_WEIGHT_DOWN = "app.vshape.tracker.action.ADJUST_WEIGHT_DOWN";
    static final String EXTRA_SESSION_ID = "sessionId";
    static final String EXTRA_EX_ID = "exId";
    static final String EXTRA_SET_INDEX = "setIndex";
    static final String EXTRA_SUGGESTED_W = "suggestedW";
    static final String EXTRA_SUGGESTED_R = "suggestedR";
    static final String EXTRA_WEIGHT_INC = "weightInc";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        Context app = context.getApplicationContext();
        String action = intent.getAction();
        String sessionId = intent.getStringExtra(EXTRA_SESSION_ID);

        if (ACTION_ADJUST_WEIGHT_UP.equals(action) || ACTION_ADJUST_WEIGHT_DOWN.equals(action)) {
            // Purely local, instant, never goes through the durable action queue: core.js has
            // nothing to reconcile until "Log Set" actually commits a value. This also means an
            // adjustment can never be "lost" to a storage failure in a way that matters - the
            // worst case is it resets to the suggested load, never a wrong committed set.
            String exId = intent.getStringExtra(EXTRA_EX_ID);
            int index = intent.getIntExtra(EXTRA_SET_INDEX, -1);
            double suggestedW = intent.getDoubleExtra(EXTRA_SUGGESTED_W, 0);
            double inc = intent.getDoubleExtra(EXTRA_WEIGHT_INC, 1);
            if (inc <= 0) inc = 1;
            JSONObject cached = ActionQueue.loadPendingAdjust(app, sessionId, exId, index);
            double base = cached != null ? cached.optDouble("w", suggestedW) : suggestedW;
            double next = ACTION_ADJUST_WEIGHT_UP.equals(action) ? base + inc : base - inc;
            ActionQueue.savePendingAdjust(app, sessionId, exId, index, next);
            showProjection(context);
            return;
        }

        if (ACTION_LOG_SET.equals(action)) {
            handleLogSet(app, context, intent, sessionId);
            return;
        }

        if (ACTION_SKIP_REST.equals(action)) {
            ActionQueue.clearNativeRest(app);
            ActionQueue.commitSimple(app, "skip-rest", sessionId);
            showProjection(context);
            return;
        }
        if (ACTION_PAUSE_REST.equals(action) || ACTION_RESUME_REST.equals(action)) {
            JSONObject rest = ActionQueue.loadNativeRest(app, sessionId);
            if (ACTION_PAUSE_REST.equals(action)) {
                if (rest != null && !rest.has("pausedRemainingMs")) {
                    long remaining = Math.max(0, rest.optLong("deadline", 0) - System.currentTimeMillis());
                    ActionQueue.updateNativeRestTiming(app, sessionId, rest.optLong("deadline", 0), remaining);
                }
            } else {
                if (rest != null && rest.has("pausedRemainingMs")) {
                    long newDeadline = System.currentTimeMillis() + rest.optLong("pausedRemainingMs", 0);
                    ActionQueue.updateNativeRestTiming(app, sessionId, newDeadline, null);
                }
            }
            ActionQueue.commitSimple(app, ACTION_PAUSE_REST.equals(action) ? "pause-rest" : "resume-rest", sessionId);
            showProjection(context);
            return;
        }
        if (ACTION_FINISH.equals(action)) {
            long seq = ActionQueue.commitSimple(app, "finish", sessionId);
            if (seq >= 0) {
                ActionQueue.clearNativeRest(app);
                // A finished workout has nothing left to show; this matches what
                // WorkoutForegroundService.ACTION_HIDE already does, done directly here so the
                // notification disappears immediately rather than waiting for core.js.
                ActionQueue.saveLastState(app, null);
                Intent hide = new Intent(context, WorkoutForegroundService.class);
                hide.setAction(WorkoutForegroundService.ACTION_HIDE);
                startServiceSafely(context, hide);
            } else {
                showPendingFallback(context, "finish");
            }
            return;
        }

        // Pause/Resume WORKOUT: elapsed-time bookkeeping (pausedMs) only core.js tracks, so
        // these still queue-and-wait, exactly as before.
        String type;
        switch (action) {
            case ACTION_PAUSE: type = "pause"; break;
            case ACTION_RESUME: type = "resume"; break;
            default: return;
        }
        ActionQueue.enqueue(app, type, sessionId);
        showPendingFallback(context, type);
    }

    private void handleLogSet(Context app, Context context, Intent intent, String sessionId) {
        String exId = intent.getStringExtra(EXTRA_EX_ID);
        int index = intent.getIntExtra(EXTRA_SET_INDEX, -1);
        double suggestedR = intent.getIntExtra(EXTRA_SUGGESTED_R, 0);

        String lastStateJson = ActionQueue.loadLastState(app);
        JSONObject lastState = parseOrNull(lastStateJson);
        JSONArray exSnapshot = lastState != null ? lastState.optJSONArray("exSnapshot") : null;
        JSONObject committedLog = lastState != null ? lastState.optJSONObject("committedLog") : null;
        JSONArray nativeCommits = ActionQueue.loadNativeCommits(app, sessionId);
        JSONObject mergedLog = WorkoutLogic.mergeLog(committedLog, nativeCommits);

        JSONObject ex = findExercise(exSnapshot, exId);
        double suggestedW = intent.getDoubleExtra(EXTRA_SUGGESTED_W, 0);
        JSONObject adj = ActionQueue.loadPendingAdjust(app, sessionId, exId, index);
        double w = adj != null ? adj.optDouble("w", suggestedW) : suggestedW;
        int r = (int) suggestedR; // reps are not adjustable from the notification - see WorkoutForegroundService

        boolean alreadyLogged = WorkoutLogic.isAlreadyLogged(mergedLog, exId, index);
        boolean valid = ex != null && !alreadyLogged && WorkoutLogic.isValidSet(ex, w, r);
        if (!valid) {
            // Honest rejection: never claim success, never advance, never start rest. The most
            // likely cause in practice is a stale button tap (the set was already logged by
            // another tap, or by the in-app UI) - showProjection() will redraw with whatever is
            // actually true now, which already accounts for that.
            showProjection(context);
            return;
        }

        long seq = ActionQueue.commitLogSet(app, sessionId, exId, index, w, r);
        if (seq < 0) {
            // Could not durably record it (e.g. disk I/O failure) - do not start rest, do not
            // claim the set is logged. The button remains tappable; the user can retry.
            showPendingFallback(context, "logset-failed");
            return;
        }
        ActionQueue.clearPendingAdjust(app);

        int restSeconds = ex.optInt("rest", 0);
        if (restSeconds > 0) {
            ActionQueue.saveNativeRest(app, sessionId, System.currentTimeMillis() + restSeconds * 1000L, null, exId, ex.optString("name", ""));
        } else {
            ActionQueue.clearNativeRest(app);
        }
        showProjection(context);
    }

    private JSONObject findExercise(JSONArray exSnapshot, String exId) {
        if (exSnapshot == null || exId == null) return null;
        for (int i = 0; i < exSnapshot.length(); i++) {
            try {
                JSONObject e = exSnapshot.getJSONObject(i);
                if (exId.equals(e.optString("id", null))) return e;
            } catch (Exception ignored) {}
        }
        return null;
    }

    private JSONObject parseOrNull(String json) {
        if (json == null) return null;
        try { return new JSONObject(json); } catch (Exception e) { return null; }
    }

    /** Tells the service to recompute its notification purely from durable native/cached state
        (lastState + nativeCommits + nativeRest + pendingAdjust) - the authoritative path used
        for every action this receiver can fully decide on its own. */
    private void showProjection(Context context) {
        Intent i = new Intent(context, WorkoutForegroundService.class);
        i.setAction(WorkoutForegroundService.ACTION_SHOW_PROJECTION);
        startServiceSafely(context, i);
    }

    /** The older "Updating…" placeholder path, kept only for the two actions this receiver
        cannot fully decide itself (Pause/Resume workout) and for the rare case a native commit
        write itself failed. */
    private void showPendingFallback(Context context, String pendingType) {
        Intent pending = new Intent(context, WorkoutForegroundService.class);
        pending.setAction(WorkoutForegroundService.ACTION_MARK_PENDING);
        pending.putExtra(WorkoutForegroundService.EXTRA_PENDING_TYPE, pendingType);
        startServiceSafely(context, pending);
    }

    private void startServiceSafely(Context context, Intent intent) {
        try {
            context.startService(intent);
        } catch (Exception ignored) {
            // The notification just won't refresh this time; the next real reconciliation
            // (or the next action tap) still corrects the displayed state.
        }
    }
}
