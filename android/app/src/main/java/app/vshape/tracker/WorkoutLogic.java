package app.vshape.tracker;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Small, pure helpers that let the notification walk forward through a workout - which set is
 * next, has an exercise's sets all been logged - using only the frozen exSnapshot and whatever
 * has actually been logged, with no history or progression logic at all (that part stays
 * JS-only; see pushNotificationState's "suggestions" lookahead table in app.js). These
 * deliberately mirror a handful of core.js functions exactly (validateSet, pendingSetsList/
 * nextPendingSet, sessionSetsDone): they are small and based on rules unlikely to change, but
 * if those core.js functions are ever edited, these must be kept in sync by hand - there is no
 * shared source between the two languages.
 */
final class WorkoutLogic {
    private WorkoutLogic() {}

    /** Mirrors core.js's validateSet: finite weight, whole positive reps, and weight may only
        be negative for an assisted exercise. */
    static boolean isValidSet(JSONObject ex, double w, int r) {
        if (Double.isNaN(w) || Double.isInfinite(w)) return false;
        if (r <= 0) return false;
        boolean assisted = ex != null && ex.optBoolean("assisted", false);
        return w >= 0 || assisted;
    }

    /** Overlays nativeCommits (sets committed by this device since the last time JS pushed a
        fresh committedLog) on top of committedLog (JS's own last-known session.log), producing
        the same shape core.js's session.log uses: {exId: [ {w,r} | null, ... ]}. This is the
        merged view everything else here reads from, so a native commit is immediately visible
        to nextPendingSet/sessionSetsDone even before JS has reconciled it. */
    static JSONObject mergeLog(JSONObject committedLog, JSONArray nativeCommits) {
        JSONObject merged = new JSONObject();
        try {
            if (committedLog != null) {
                java.util.Iterator<String> keys = committedLog.keys();
                while (keys.hasNext()) {
                    String k = keys.next();
                    JSONArray src = committedLog.optJSONArray(k);
                    merged.put(k, src != null ? new JSONArray(src.toString()) : new JSONArray());
                }
            }
        } catch (Exception ignored) {}
        if (nativeCommits != null) {
            for (int i = 0; i < nativeCommits.length(); i++) {
                try {
                    JSONObject c = nativeCommits.getJSONObject(i);
                    String exId = c.getString("exId");
                    int idx = c.getInt("index");
                    JSONArray arr = merged.has(exId) ? merged.getJSONArray(exId) : new JSONArray();
                    while (arr.length() <= idx) arr.put((Object) null);
                    JSONObject entry = new JSONObject();
                    entry.put("w", c.getDouble("w"));
                    entry.put("r", c.getInt("r"));
                    arr.put(idx, entry);
                    merged.put(exId, arr);
                } catch (Exception ignored) {}
            }
        }
        return merged;
    }

    /** True if the given exercise+set index is already present (non-null) in the merged log -
        the native-side duplicate guard, independent of (and in addition to) core.js's own
        'set-already-logged' check once JS reconciles the queued action. */
    static boolean isAlreadyLogged(JSONObject mergedLog, String exId, int index) {
        JSONArray arr = mergedLog.optJSONArray(exId);
        return arr != null && index < arr.length() && !arr.isNull(index);
    }

    /** Mirrors core.js's pendingSetsList/nextPendingSet: the first not-yet-logged set in
        program order, or null once every exercise's every set is logged. The returned object
        carries the matching exSnapshot entry too, so a caller never needs a second lookup. */
    static JSONObject nextPendingSet(JSONArray exSnapshot, JSONObject mergedLog) {
        if (exSnapshot == null) return null;
        for (int i = 0; i < exSnapshot.length(); i++) {
            JSONObject ex;
            try { ex = exSnapshot.getJSONObject(i); } catch (Exception e) { continue; }
            String exId = ex.optString("id", null);
            int sets = ex.optInt("sets", 0);
            if (exId == null) continue;
            JSONArray logged = mergedLog.optJSONArray(exId);
            for (int j = 0; j < sets; j++) {
                boolean done = logged != null && j < logged.length() && !logged.isNull(j);
                if (!done) {
                    try {
                        JSONObject out = new JSONObject();
                        out.put("exIndex", i);
                        out.put("exId", exId);
                        out.put("setIndex", j);
                        out.put("ex", ex);
                        return out;
                    } catch (Exception e) { return null; }
                }
            }
        }
        return null;
    }

    /** Mirrors core.js's sessionSetsDone's done/total counting (not the volume figure, which
        the notification does not need). */
    static int[] setsDoneTotal(JSONArray exSnapshot, JSONObject mergedLog) {
        int done = 0, total = 0;
        if (exSnapshot != null) {
            for (int i = 0; i < exSnapshot.length(); i++) {
                JSONObject ex;
                try { ex = exSnapshot.getJSONObject(i); } catch (Exception e) { continue; }
                int sets = ex.optInt("sets", 0);
                total += sets;
                String exId = ex.optString("id", null);
                JSONArray logged = exId != null ? mergedLog.optJSONArray(exId) : null;
                if (logged != null) {
                    for (int j = 0; j < logged.length(); j++) if (!logged.isNull(j)) done++;
                }
            }
        }
        return new int[] { done, total };
    }

    /** How many of THIS exercise's own sets are logged - for the per-exercise progress shown
        alongside the whole-workout count. */
    static int exerciseSetsDone(JSONObject mergedLog, String exId) {
        JSONArray logged = exId != null ? mergedLog.optJSONArray(exId) : null;
        if (logged == null) return 0;
        int done = 0;
        for (int j = 0; j < logged.length(); j++) if (!logged.isNull(j)) done++;
        return done;
    }

    /** Looks up this exercise's suggested load/reps for a specific set index from the
        lookahead table app.js's pushNotificationState() sends (one entry per exercise that
        still has pending sets, each with the full reps array) - never computed natively, since
        that needs full training history, which only JS has. */
    static double suggestedW(JSONArray suggestions, String exId) {
        JSONObject e = findSuggestion(suggestions, exId);
        return e != null ? e.optDouble("w", 0) : 0;
    }

    static int suggestedR(JSONArray suggestions, String exId, int setIndex) {
        JSONObject e = findSuggestion(suggestions, exId);
        if (e == null) return 0;
        JSONArray reps = e.optJSONArray("reps");
        if (reps == null || setIndex < 0 || setIndex >= reps.length()) return 0;
        return reps.optInt(setIndex, 0);
    }

    private static JSONObject findSuggestion(JSONArray suggestions, String exId) {
        if (suggestions == null || exId == null) return null;
        for (int i = 0; i < suggestions.length(); i++) {
            try {
                JSONObject e = suggestions.getJSONObject(i);
                if (exId.equals(e.optString("exId", null))) return e;
            } catch (Exception ignored) {}
        }
        return null;
    }

    /** What nativeRest should become from a freshly-pushed JS state payload - pure and
        Context-free, so this decision (not just the SharedPreferences write it leads to) is
        unit-testable. Mirrors the restActive/restPaused/restDeadlineEpochMs/restRemainingMs
        fields app.js's pushNotificationState() sends. Both sides use the same wall-clock
        epoch-millisecond basis (JS Date.now(), Java System.currentTimeMillis()), so nothing
        here converts between time bases - it is already one consistent one. Returns null when
        nativeRest should be cleared instead (no rest active, or an active rest with a missing
        /invalid deadline - fail safe to "not resting" rather than risk a stuck/wrong display). */
    static NativeRestSync syncRestFromState(JSONObject s) {
        if (s == null || !s.optBoolean("restActive", false)) return null;
        String sessionId = s.optString("sessionId", null);
        String exId = s.optString("exId", null);
        String exName = s.optString("exerciseName", null);
        if (s.optBoolean("restPaused", false)) {
            return new NativeRestSync(sessionId, 0L, s.optLong("restRemainingMs", 0), exId, exName);
        }
        long deadline = s.optLong("restDeadlineEpochMs", 0);
        if (deadline <= 0) return null;
        return new NativeRestSync(sessionId, deadline, null, exId, exName);
    }

    static final class NativeRestSync {
        final String sessionId;
        final long deadlineEpochMs;
        final Long pausedRemainingMs;
        final String exId;
        final String exName;
        NativeRestSync(String sessionId, long deadlineEpochMs, Long pausedRemainingMs, String exId, String exName) {
            this.sessionId = sessionId;
            this.deadlineEpochMs = deadlineEpochMs;
            this.pausedRemainingMs = pausedRemainingMs;
            this.exId = exId;
            this.exName = exName;
        }
    }
}
