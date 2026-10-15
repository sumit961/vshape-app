package app.vshape.tracker;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Handles a tap on a notification action button. This must work whether the
 * app/WebView is alive or not, so it does exactly one thing: append the
 * action to the durable queue (see ActionQueue). It never recomputes or
 * guesses workout state itself — that happens once, in core.js, the next
 * time the app reconciles the queue (on resume, or shortly after launch).
 */
public class WorkoutActionReceiver extends BroadcastReceiver {
    static final String ACTION_PAUSE = "app.vshape.tracker.action.PAUSE";
    static final String ACTION_RESUME = "app.vshape.tracker.action.RESUME";
    static final String ACTION_SKIP_REST = "app.vshape.tracker.action.SKIP_REST";
    static final String EXTRA_SESSION_ID = "sessionId";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        String sessionId = intent.getStringExtra(EXTRA_SESSION_ID);
        String type;
        switch (intent.getAction()) {
            case ACTION_PAUSE: type = "pause"; break;
            case ACTION_RESUME: type = "resume"; break;
            case ACTION_SKIP_REST: type = "skip-rest"; break;
            default: return;
        }
        ActionQueue.enqueue(context.getApplicationContext(), type, sessionId);

        // Give instant, honest feedback on the notification itself (its button
        // taps are the only thing that must never feel stuck) without claiming
        // the action has actually been applied - that only happens once
        // core.js reconciles it. The service is necessarily already running,
        // since this broadcast only fires from a tap on its own live
        // notification, so updating it here is not a background FGS start.
        Intent pending = new Intent(context, WorkoutForegroundService.class);
        pending.setAction(WorkoutForegroundService.ACTION_MARK_PENDING);
        pending.putExtra(WorkoutForegroundService.EXTRA_PENDING_TYPE, type);
        try {
            context.startService(pending);
        } catch (Exception ignored) {
            // The notification just won't show a "pending" hint this time; the
            // next real reconciliation still corrects the displayed state.
        }
    }
}
