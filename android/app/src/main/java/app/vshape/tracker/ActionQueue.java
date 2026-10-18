package app.vshape.tracker;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Durable, idempotent queue for notification button taps. A tap just appends
 * {seq, type, sessionId, ts} here (works even if the WebView/app process is
 * dead); core.js's reconcileActions() is the only thing that ever interprets
 * these actions, so there is exactly one place that understands workout state.
 */
final class ActionQueue {
    private static final String PREFS = "vshape_workout_actions";
    private static final String KEY_QUEUE = "queue";
    private static final String KEY_SEQ = "seq";
    private static final String KEY_LAST_STATE = "lastState";
    private static final String KEY_ERROR = "error";
    private static final String KEY_PENDING_ADJUST = "pendingAdjust";
    private static final String KEY_NATIVE_COMMITS = "nativeCommits";
    private static final String KEY_NATIVE_COMMITS_SESSION = "nativeCommitsSession";
    private static final String KEY_NATIVE_REST = "nativeRest";

    private ActionQueue() {}

    /**
     * The "moment of truth" for Phase 2B.3's background logging: validates nothing itself
     * (the caller - WorkoutActionReceiver - already checked WorkoutLogic.isValidSet and
     * duplicate-index before calling this), and durably records a logged set in TWO places in
     * one atomic, SYNCHRONOUS write:
     *   1. the existing action queue, exactly as before, for core.js to reconcile into
     *      session.log/localStorage once the WebView next runs;
     *   2. a native "commits since the last JS sync" cache, which is what lets the
     *      notification immediately treat this set as logged and move on, without waiting for
     *      that reconciliation.
     * Uses SharedPreferences.Editor.commit() (synchronous, blocks for disk I/O) rather than
     * apply() specifically for this write: a BroadcastReceiver's process can be killed shortly
     * after onReceive() returns, and an async apply() would not be verifiably durable before
     * that could happen. The boolean return is the honest signal of whether this actually
     * happened - callers must not advance the notification/start rest unless this is true.
     *
     * Allocates its own seq atomically (read KEY_SEQ, assign seq+1, commit) in the SAME
     * synchronized call, rather than taking a pre-"peeked" seq from the caller: two
     * WorkoutActionReceiver.onReceive() invocations running back to back (e.g. two broadcasts
     * delivered in quick succession from a fast double-tap, both passing their own
     * already-logged/validity checks before either commits) must never be able to read the
     * same "next" seq value and both write a logset action carrying it - that would let a
     * second, truly distinct commit either collide with or be silently treated as a duplicate
     * of the first by core.js's seq-based idempotency check instead of being its own, correctly
     * numbered action.
     */
    static synchronized long commitLogSet(Context ctx, String sessionId, String exId, int index, double w, int r) {
        SharedPreferences p = prefs(ctx);
        long seq = p.getLong(KEY_SEQ, 0L) + 1;
        try {
            JSONArray queue = new JSONArray(p.getString(KEY_QUEUE, "[]"));
            JSONObject action = new JSONObject();
            action.put("seq", seq);
            action.put("type", "logset");
            action.put("sessionId", sessionId == null ? "" : sessionId);
            action.put("exId", exId);
            action.put("index", index);
            action.put("w", w);
            action.put("r", r);
            action.put("ts", System.currentTimeMillis());
            queue.put(action);

            JSONArray commits = loadNativeCommitsRaw(p, sessionId);
            JSONObject c = new JSONObject();
            c.put("exId", exId);
            c.put("index", index);
            c.put("w", w);
            c.put("r", r);
            commits.put(c);

            boolean ok = p.edit()
                .putLong(KEY_SEQ, seq)
                .putString(KEY_QUEUE, queue.toString())
                .putString(KEY_NATIVE_COMMITS, commits.toString())
                .putString(KEY_NATIVE_COMMITS_SESSION, sessionId == null ? "" : sessionId)
                .commit();
            return ok ? seq : -1;
        } catch (Exception e) {
            return -1;
        }
    }

    /** Sets committed by THIS device since the last time JS pushed a fresh committedLog (see
        pruneNativeCommits) - empty if there is no session in progress or the cache belongs to
        a different (e.g. already-finished) session. */
    static JSONArray loadNativeCommits(Context ctx, String sessionId) {
        return loadNativeCommitsRaw(prefs(ctx), sessionId);
    }

    private static JSONArray loadNativeCommitsRaw(SharedPreferences p, String sessionId) {
        String cachedSession = p.getString(KEY_NATIVE_COMMITS_SESSION, "");
        if (!cachedSession.equals(sessionId == null ? "" : sessionId)) return new JSONArray();
        try {
            return new JSONArray(p.getString(KEY_NATIVE_COMMITS, "[]"));
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    /** Drops any cached native commit that a freshly-pushed committedLog now already reflects
        (settled - whether JS's own reconciliation applied the exact value or not, JS is the
        final authority and the slot is no longer "ahead of JS"); keeps the rest, so native's
        own projection stays correctly advanced for sets JS has not caught up on yet. This is
        what stops a native commit that has already been folded into localStorage - or an
        in-app change, such as an undo - from silently lingering and diverging from the truth. */
    static synchronized void pruneNativeCommits(Context ctx, String sessionId, JSONObject committedLog) {
        SharedPreferences p = prefs(ctx);
        JSONArray commits = loadNativeCommitsRaw(p, sessionId);
        if (commits.length() == 0) return;
        JSONArray kept = new JSONArray();
        for (int i = 0; i < commits.length(); i++) {
            try {
                JSONObject c = commits.getJSONObject(i);
                String exId = c.getString("exId");
                int index = c.getInt("index");
                JSONArray logged = committedLog != null ? committedLog.optJSONArray(exId) : null;
                boolean settled = logged != null && index < logged.length() && !logged.isNull(index);
                if (!settled) kept.put(c);
            } catch (Exception ignored) {}
        }
        p.edit()
            .putString(KEY_NATIVE_COMMITS, kept.toString())
            .putString(KEY_NATIVE_COMMITS_SESSION, sessionId == null ? "" : sessionId)
            .apply();
    }

    static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static synchronized void enqueue(Context ctx, String type, String sessionId) {
        enqueueWithExtras(ctx, type, sessionId, null);
    }

    private static synchronized void enqueueWithExtras(Context ctx, String type, String sessionId, JSONObject extras) {
        SharedPreferences p = prefs(ctx);
        long seq = p.getLong(KEY_SEQ, 0L) + 1;
        try {
            JSONArray arr = new JSONArray(p.getString(KEY_QUEUE, "[]"));
            JSONObject action = new JSONObject();
            action.put("seq", seq);
            action.put("type", type);
            action.put("sessionId", sessionId == null ? "" : sessionId);
            action.put("ts", System.currentTimeMillis());
            if (extras != null) {
                java.util.Iterator<String> keys = extras.keys();
                while (keys.hasNext()) {
                    String k = keys.next();
                    action.put(k, extras.get(k));
                }
            }
            arr.put(action);
            p.edit().putLong(KEY_SEQ, seq).putString(KEY_QUEUE, arr.toString()).apply();
        } catch (Exception e) {
            // Even if the queue itself is somehow corrupt, keep the sequence counter moving
            // forward so a later, well-formed action is never mistaken for a duplicate.
            p.edit().putLong(KEY_SEQ, seq).apply();
        }
    }

    /** A weight adjustment the user is dialing in on the notification itself, BEFORE tapping
        "Log Set" - deliberately never written to the durable action queue (core.js/the session
        never needs to know about an adjustment that was never committed). It only exists so the
        foreground service can redraw the notification instantly, entirely natively, without
        waking the WebView for every +/- tap. Log Set reads whatever is here (if it still
        matches the exercise/set it was cached for) as the exact value to commit, then this is
        cleared - the next pending set always starts from the suggested load again, never a
        leftover adjustment from a different set. */
    static void savePendingAdjust(Context ctx, String sessionId, String exId, int index, double w) {
        try {
            JSONObject o = new JSONObject();
            o.put("sessionId", sessionId);
            o.put("exId", exId);
            o.put("index", index);
            o.put("w", w);
            prefs(ctx).edit().putString(KEY_PENDING_ADJUST, o.toString()).apply();
        } catch (Exception ignored) {}
    }

    /** Returns the cached adjustment only if it matches this exact session/exercise/set index;
        otherwise null, treated by callers exactly like "no adjustment yet" - a stale adjustment
        left over from a previous (already logged) set must never leak into a new one. */
    static JSONObject loadPendingAdjust(Context ctx, String sessionId, String exId, int index) {
        String raw = prefs(ctx).getString(KEY_PENDING_ADJUST, null);
        if (raw == null) return null;
        try {
            JSONObject o = new JSONObject(raw);
            if (!o.optString("sessionId", "").equals(sessionId == null ? "" : sessionId)) return null;
            if (!o.optString("exId", "").equals(exId == null ? "" : exId)) return null;
            if (o.optInt("index", -1) != index) return null;
            return o;
        } catch (Exception e) {
            return null;
        }
    }

    static void clearPendingAdjust(Context ctx) {
        prefs(ctx).edit().remove(KEY_PENDING_ADJUST).apply();
    }

    /** Durably records an action that does not need Phase 2B.3's native commit-cache
        treatment (skip-rest, pause-rest, resume-rest, finish) - these do not need validation
        or a duplicate-index check the way logset does, but still use commit() (synchronous)
        rather than apply() so the caller gets an honest, verified answer before updating the
        notification to reflect them as done. Returns the seq assigned, or -1 on failure. */
    static synchronized long commitSimple(Context ctx, String type, String sessionId) {
        SharedPreferences p = prefs(ctx);
        long seq = p.getLong(KEY_SEQ, 0L) + 1;
        try {
            JSONArray arr = new JSONArray(p.getString(KEY_QUEUE, "[]"));
            JSONObject action = new JSONObject();
            action.put("seq", seq);
            action.put("type", type);
            action.put("sessionId", sessionId == null ? "" : sessionId);
            action.put("ts", System.currentTimeMillis());
            arr.put(action);
            boolean ok = p.edit().putLong(KEY_SEQ, seq).putString(KEY_QUEUE, arr.toString()).commit();
            return ok ? seq : -1;
        } catch (Exception e) {
            return -1;
        }
    }

    /** Native's own rest-countdown deadline, tracked independently of JS's session.rest so the
        notification can start/skip/pause/resume a rest period immediately while backgrounded.
        Cleared (and ignored, via the session-id match) once the workout the rest belonged to is
        no longer the current one. pausedRemainingMs is null while running. */
    static void saveNativeRest(Context ctx, String sessionId, long deadlineEpochMs, Long pausedRemainingMs, String exId, String exName) {
        try {
            JSONObject o = new JSONObject();
            o.put("sessionId", sessionId == null ? "" : sessionId);
            o.put("deadline", deadlineEpochMs);
            if (pausedRemainingMs != null) o.put("pausedRemainingMs", (long) pausedRemainingMs);
            if (exId != null) o.put("exId", exId);
            if (exName != null) o.put("exName", exName);
            prefs(ctx).edit().putString(KEY_NATIVE_REST, o.toString()).apply();
        } catch (Exception ignored) {}
    }

    /** Re-saves the same native rest with an updated deadline/pause state, keeping whichever
        exercise identity it already had - used when pausing/resuming the rest countdown itself
        (Pause rest/Resume rest), as opposed to starting a brand new one from a fresh log. */
    static void updateNativeRestTiming(Context ctx, String sessionId, long deadlineEpochMs, Long pausedRemainingMs) {
        JSONObject existing = loadNativeRest(ctx, sessionId);
        String exId = existing != null ? existing.optString("exId", null) : null;
        String exName = existing != null ? existing.optString("exName", null) : null;
        saveNativeRest(ctx, sessionId, deadlineEpochMs, pausedRemainingMs, exId, exName);
    }

    static JSONObject loadNativeRest(Context ctx, String sessionId) {
        String raw = prefs(ctx).getString(KEY_NATIVE_REST, null);
        if (raw == null) return null;
        try {
            JSONObject o = new JSONObject(raw);
            if (!o.optString("sessionId", "").equals(sessionId == null ? "" : sessionId)) return null;
            return o;
        } catch (Exception e) {
            return null;
        }
    }

    static void clearNativeRest(Context ctx) {
        prefs(ctx).edit().remove(KEY_NATIVE_REST).apply();
    }

    static String readQueueJson(Context ctx) {
        return prefs(ctx).getString(KEY_QUEUE, "[]");
    }

    static synchronized void clearUpTo(Context ctx, long upTo) {
        SharedPreferences p = prefs(ctx);
        try {
            JSONArray arr = new JSONArray(p.getString(KEY_QUEUE, "[]"));
            JSONArray kept = new JSONArray();
            for (int i = 0; i < arr.length(); i++) {
                JSONObject a = arr.getJSONObject(i);
                if (a.optLong("seq", 0L) > upTo) kept.put(a);
            }
            p.edit().putString(KEY_QUEUE, kept.toString()).apply();
        } catch (Exception e) {
            p.edit().putString(KEY_QUEUE, "[]").apply();
        }
    }

    /** Last state JSON passed to show(), so a notification action can be redrawn
        with a "pending" marker instantly, without needing the WebView awake.
        Every fresh state from JS also prunes the native-commits cache against its
        committedLog (see pruneNativeCommits) - this is the one place that always happens,
        rather than relying on every caller to remember it. */
    static void saveLastState(Context ctx, String stateJson) {
        prefs(ctx).edit().putString(KEY_LAST_STATE, stateJson).apply();
        if (stateJson == null) return;
        try {
            JSONObject s = new JSONObject(stateJson);
            pruneNativeCommits(ctx, s.optString("sessionId", null), s.optJSONObject("committedLog"));
        } catch (Exception ignored) {}
    }

    static String loadLastState(Context ctx) {
        return prefs(ctx).getString(KEY_LAST_STATE, null);
    }

    /** Records a foreground-service/notification failure for the JS side to
        surface once. Read-once: readAndClearError() returns it then clears it,
        so the same failure is never reported twice. */
    static void recordError(Context ctx, String message) {
        prefs(ctx).edit().putString(KEY_ERROR, message).apply();
    }

    static synchronized String readAndClearError(Context ctx) {
        SharedPreferences p = prefs(ctx);
        String msg = p.getString(KEY_ERROR, null);
        if (msg != null) p.edit().remove(KEY_ERROR).apply();
        return msg;
    }

    /** A read-only diagnostic snapshot of this device's entire native journal, for the
        "Export diagnostic report" feature: the raw pending-action queue, the native-commits
        cache and which session it belongs to, any in-flight native rest deadline, any
        uncommitted weight adjustment, the sessionId/exId/set ids of whatever JS last pushed
        (not the full state - see below), and any recorded error. This is workout mechanics
        only (ids, seqs, weights, reps) - nothing from the app's food/weight/photo data ever
        passes through this journal in the first place, so there is nothing extra to redact.
        Never mutates anything - purely informational. */
    static JSONObject dumpDiagnostics(Context ctx) {
        SharedPreferences p = prefs(ctx);
        JSONObject out = new JSONObject();
        try {
            out.put("seq", p.getLong(KEY_SEQ, 0L));
            out.put("queue", new JSONArray(p.getString(KEY_QUEUE, "[]")));
            out.put("nativeCommitsSession", p.getString(KEY_NATIVE_COMMITS_SESSION, ""));
            out.put("nativeCommits", new JSONArray(p.getString(KEY_NATIVE_COMMITS, "[]")));
            String lastState = p.getString(KEY_LAST_STATE, null);
            if (lastState != null) {
                try {
                    JSONObject s = new JSONObject(lastState);
                    JSONObject summary = new JSONObject();
                    summary.put("sessionId", s.optString("sessionId", null));
                    summary.put("status", s.optString("status", null));
                    summary.put("lastAppliedSeq", s.optLong("lastAppliedSeq", 0));
                    JSONArray exSnapshot = s.optJSONArray("exSnapshot");
                    summary.put("exSnapshotCount", exSnapshot != null ? exSnapshot.length() : 0);
                    out.put("lastState", summary);
                } catch (Exception ignored) {}
            }
            out.put("hasNativeRest", p.getString(KEY_NATIVE_REST, null) != null);
            JSONObject pendingAdjust = null;
            String pendingAdjustRaw = p.getString(KEY_PENDING_ADJUST, null);
            if (pendingAdjustRaw != null) { try { pendingAdjust = new JSONObject(pendingAdjustRaw); } catch (Exception ignored) {} }
            out.put("hasPendingAdjust", pendingAdjust != null);
            out.put("lastError", p.getString(KEY_ERROR, null));
        } catch (Exception ignored) {}
        return out;
    }
}
