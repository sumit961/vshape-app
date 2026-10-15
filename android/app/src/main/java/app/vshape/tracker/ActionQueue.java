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

    private ActionQueue() {}

    static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static synchronized void enqueue(Context ctx, String type, String sessionId) {
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
            p.edit().putLong(KEY_SEQ, seq).putString(KEY_QUEUE, arr.toString()).apply();
        } catch (Exception e) {
            // Even if the queue itself is somehow corrupt, keep the sequence counter moving
            // forward so a later, well-formed action is never mistaken for a duplicate.
            p.edit().putLong(KEY_SEQ, seq).apply();
        }
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
}
