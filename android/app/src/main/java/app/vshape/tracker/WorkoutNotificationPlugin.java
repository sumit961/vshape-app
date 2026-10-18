package app.vshape.tracker;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import org.json.JSONException;

/**
 * Thin JS <-> native bridge for the active-workout notification. On purpose
 * it does almost nothing itself: show()/hide() just forward the current
 * state to WorkoutForegroundService, and getPendingActions()/
 * clearPendingActions() expose the durable action queue that
 * WorkoutActionReceiver writes to. All real workout logic (what "pause"
 * means, whether an action is stale) lives in core.js on the JS side.
 */
@CapacitorPlugin(
    name = "WorkoutNotification",
    permissions = { @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications") }
)
public class WorkoutNotificationPlugin extends Plugin {

    @PluginMethod
    public void show(PluginCall call) {
        Intent i = new Intent(getContext(), WorkoutForegroundService.class);
        i.setAction(WorkoutForegroundService.ACTION_SHOW);
        i.putExtra(WorkoutForegroundService.EXTRA_STATE, call.getData().toString());
        try {
            getContext().startForegroundService(i);
            call.resolve();
        } catch (Exception e) {
            // e.g. a background-start restriction, or the service rejecting the
            // startForeground() call itself (see WorkoutForegroundService). The
            // workout still tracks fine in-app without the notification.
            JSObject ret = new JSObject();
            ret.put("error", "could not show the notification (" + e.getClass().getSimpleName() + ")");
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void hide(PluginCall call) {
        Intent i = new Intent(getContext(), WorkoutForegroundService.class);
        i.setAction(WorkoutForegroundService.ACTION_HIDE);
        try {
            getContext().startService(i);
        } catch (Exception ignored) {
            // Nothing to clean up on our side if the service was never running.
        }
        call.resolve();
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33) {
            resolveWithStatus(call, areNotificationsEnabled() ? "granted" : "denied");
            return;
        }
        if (getPermissionState("notifications") == PermissionState.GRANTED) {
            resolveWithStatus(call, "granted");
            return;
        }
        requestPermissionForAlias("notifications", call, "permissionCallback");
    }

    @PluginMethod
    public void checkPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33) {
            resolveWithStatus(call, areNotificationsEnabled() ? "granted" : "denied");
        } else {
            resolveWithStatus(call, getPermissionState("notifications") == PermissionState.GRANTED ? "granted" : "denied");
        }
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        resolveWithStatus(call, getPermissionState("notifications") == PermissionState.GRANTED ? "granted" : "denied");
    }

    private void resolveWithStatus(PluginCall call, String status) {
        JSObject ret = new JSObject();
        ret.put("status", status);
        call.resolve(ret);
    }

    private boolean areNotificationsEnabled() {
        return NotificationManagerCompat.from(getContext()).areNotificationsEnabled();
    }

    @PluginMethod
    public void getPendingActions(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            ret.put("actions", new JSArray(ActionQueue.readQueueJson(getContext())));
        } catch (JSONException e) {
            ret.put("actions", new JSArray());
        }
        String error = ActionQueue.readAndClearError(getContext());
        if (error != null) ret.put("error", error);
        call.resolve(ret);
    }

    @PluginMethod
    public void clearPendingActions(PluginCall call) {
        Long upTo = call.getLong("upTo", 0L);
        ActionQueue.clearUpTo(getContext(), upTo == null ? 0L : upTo);
        call.resolve();
    }

    /** Read-only diagnostic snapshot of the native action journal for the JS side's
        "Export diagnostic report" feature - see ActionQueue.dumpDiagnostics. */
    @PluginMethod
    public void getDiagnostics(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            ret.put("journal", ActionQueue.dumpDiagnostics(getContext()));
        } catch (Exception e) {
            ret.put("error", "could not read the native journal (" + e.getClass().getSimpleName() + ")");
        }
        call.resolve(ret);
    }
}
