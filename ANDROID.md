# Getting steps from your Android phone

A web page cannot read Samsung Health or Google Fit. The Android app build can: it reads
**Health Connect** (Samsung Health, Google Fit and most watches write into it).

Reads: steps, weight, active calories, resting heart rate. Nothing is written back.

## One-time setup (on a PC)
1. Install **Android Studio** (it brings JDK 17 and the Android SDK).
2. In Samsung Health: Settings > Connected services > Health Connect, allow Steps (and the others you want).
   Health Connect is built into Android 14+; on older phones install it from the Play Store.
3. In this folder run:
   ```
   npm install
   npm run android
   ```
   That copies the web app, syncs the Android project and opens it in Android Studio.
4. Plug in your phone (USB debugging on) and press Run. The app is installed as "V-Shape".

## Using Health Connect
Open the app. It syncs on launch and when you come back to it. The "Sync from Health Connect"
button on the Today tab syncs the last 30 days. Accept the permission prompt the first time.
A silent (launch/background) sync never opens the permission screen on its own — if the plugin
can't confirm permission without prompting, it just skips that sync rather than guessing.

Steps from several sources (phone and watch) are not added together; the biggest single source
for each day is used so nothing is double counted. A step count you typed in or imported from a
file is never silently overwritten by a phone sync; if the phone has a different number for that
day, a "Use phone value" button appears instead.

**Not verified on a real device yet:** whether the installed `capacitor-health-connect` plugin's
permission-check method names match what `app.js` calls (`hcSync` falls back to skipping a silent
sync if it can't find one, rather than guessing or prompting). Confirm this once you can run the
app on a phone.

## Workout notification (Phase 2A)

While a workout session is active or paused, the Android app shows a persistent "ongoing"
notification: workout name, elapsed time, current exercise, sets done vs. planned, a rest
countdown when resting, and Pause/Resume plus Skip Rest action buttons. Tapping the notification
body opens the app. It is a plain `NotificationCompat` notification with a `specialUse` foreground
service (`android/app/src/main/java/app/vshape/tracker/WorkoutForegroundService.java`) — not
`MediaSession` or a `mediaPlayback` foreground service, since this isn't audio/media playback.

**Foreground-service type, corrected in 2A.1:** the first pass of this feature used Android 14's
`"health"` foreground-service type. Checked against Android's own foreground-service-types docs,
that type requires the app to already hold one of `BODY_SENSORS`, `ACTIVITY_RECOGNITION`,
`READ_HEART_RATE`, `READ_SKIN_TEMPERATURE` or `READ_OXYGEN_SATURATION` — raw sensor/health runtime
permissions this app has no legitimate reason to request (it only reads Health Connect data, a
separate permission namespace). Adding one of those permissions purely to satisfy the type would
have been exactly the "add an unrelated permission to bypass a restriction" anti-pattern this
phase was meant to avoid. On a real Android 14+ device the old code would most likely have thrown
when starting the service. It now uses the `"specialUse"` catch-all type instead (with the
required `PROPERTY_SPECIAL_USE_FGS_SUBTYPE` manifest property), which fits a user-visible,
user-initiated status notification with no special data access. One real-world catch: Google Play
Console reviews the declared `specialUse` subtype and its justification before the app can be
published with it — that only matters if/when this is submitted to Play, not for a local debug
build or sideloaded APK.

**Permissions:** `POST_NOTIFICATIONS` (Android 13+ runtime permission — if denied, the workout
still tracks fine inside the app; you can enable it later from Settings), `FOREGROUND_SERVICE` and
`FOREGROUND_SERVICE_SPECIAL_USE`. No location, microphone, camera, exact-alarm, battery-exemption,
or body-sensor permission is requested.

**Startup failures are now handled, not just hoped against.** Both the plugin's call to
`startForegroundService()` and the service's own call to `startForeground()` are wrapped in
try/catch. A failure (denied notification permission, a background-start restriction, anything
else) is logged, the half-started service is stopped, and the failure is recorded durably
(`ActionQueue.recordError`) so the next time the app polls the native side it surfaces a one-time
toast — it is never a silent exception, and it never crashes the app or leaves the workout
untracked.

**How actions survive the app being killed:** a tap on Pause/Resume/Skip Rest is handled by
`WorkoutActionReceiver`, a manifest-registered `BroadcastReceiver` that runs even if the app
process is dead. It never computes workout state itself — it only appends `{seq, type,
sessionId, ts}` to a durable queue in `SharedPreferences` (`ActionQueue.java`). The app drains
and applies that queue through `core.js`'s `reconcileActions()` (seq-ordered, idempotent, skips
stale/duplicate/wrong-session actions) the next time it's foregrounded or resumed — there is
exactly one place that decides what "pause" means. If you kill the app mid-rest and reopen it
later, the pending action is still applied correctly, and it is only ever applied once (each
action carries a monotonically increasing sequence number; `reconcileActions()` rejects anything
at or below the last one it already applied).

**Immediate feedback on a tap, fixed in 2A.1:** previously, tapping Pause/Resume/Skip Rest only
queued the action — the notification itself didn't change until the app next woke up and
reconciled, which could look stuck for a while if the app was backgrounded. The receiver now also
redraws the notification from its last known state the instant a button is tapped, showing
"Updating…" rather than changing the real status — it never claims the action succeeded before
`core.js` has actually applied it; that's just an honest "we heard you" marker. The queue itself
is only ever cleared for actions that were actually processed (applied *or* intentionally
rejected, e.g. stale/duplicate/wrong-session) — a previous version could leave a genuinely
unrecognized action stuck in the queue forever, periodically retried but never cleared; it is now
always acknowledged once handled, in either direction.

**Elapsed time and rest countdown** are driven by the notification's own native `Chronometer`
(`setUsesChronometer` / `setChronometerCountDown` against a fixed deadline), so Android ticks them
down itself — the notification is only rebuilt on a real state change (new set, pause, resume,
rest starting/ending), never once a second from JS. Fixed in 2A.1: pausing/resuming/skipping rest
from the in-app timer widget (as opposed to the full-screen re-render that most other actions
trigger) used to update only the in-app widget and leave the notification showing a stale
countdown, including a stuck "0:00" once rest actually ended; all three paths now explicitly
refresh the notification too.

**Same-day repeated workouts, fixed in 2A.1:** starting a second, separate workout of a program
day you had already *finished* earlier the same day used to silently reopen and resume logging
into that finished session instead of creating a new one (`startOrGetSession` matched on "the
last session for this date and program day," regardless of its status). It now only ever reuses a
session that is still `active`/`paused`; a finished session is never reused or written to again,
and starting again after finishing always creates a genuinely new session. One session that's
still open elsewhere (a different program day, or an earlier unfinished one) still blocks starting
a second concurrent one, as before.

**Known platform trade-offs (not verified on a device):**
- A stock `NotificationCompat` notification only has one built-in chronometer, so while a rest
  countdown is running it temporarily replaces the workout's elapsed-time display; the elapsed
  time resumes once rest ends or is skipped. Showing both at once would need a custom
  `RemoteViews` layout, which the spec for this phase explicitly said not to combine with the
  rest of this design.
- "Android Live Updates" / ProgressStyle and any Android-17-specific "MetricStyle" enhancement
  were not attempted: Android 17 does not exist as a released version as of this writing, and the
  baseline `NotificationCompat` approach above was the one asked to be treated as the safe
  fallback. Revisit this once a concrete, shipped API is confirmed.
- The notification icon (`res/drawable/ic_notification.xml`) is a placeholder badge shape, not a
  pixel-matched export of the real V-Shape mark.
- Samsung's notification shade sometimes collapses/orders actions differently from Pixel's; this
  has not been checked on a Samsung device.
- Fixed in the 2A.1 verification pass: `hide()` now also clears the service's cached "last known
  state," and the service no longer returns `START_STICKY` anywhere, so (a) a notification tap
  that was already in flight when the workout finished can no longer resurrect a ghost
  notification via the pending-feedback path, and (b) the OS restarting the service after an
  unrelated memory-pressure kill can't show a stale/empty notification with no real data behind
  it. Not confirmed on a real device.
- The Play Console review requirement for the `specialUse` foreground-service subtype (see above)
  has not been exercised — this app is a debug/sideloaded build only, so it hasn't gone through
  that review.

## Smart workout notification (Phase 2B.2 → 2B.3: true background logging)

**Phase 2B.2's limitation (now fixed): Log Set while backgrounded used to only *enqueue* the
action and wait for the WebView to next run before anything was actually recorded.** Phase 2B.3
replaces that for the actions that matter for background logging. `WorkoutActionReceiver` now
validates and durably commits Log Set, Skip Rest, Pause/Resume Rest and Finish **itself**, natively,
synchronously, with no WebView involvement:
- `ActionQueue.commitLogSet`/`commitSimple` write with `SharedPreferences.Editor.commit()`
  (synchronous, verified) rather than `apply()` (async, fire-and-forget) specifically because a
  BroadcastReceiver's process can be killed moments after `onReceive()` returns - the boolean
  result is checked before the notification is allowed to claim anything succeeded.
- `WorkoutLogic.java` (a small, pure, deliberately-duplicated port of core.js's
  `validateSet`/`pendingSetsList`/`sessionSetsDone` - see its class comment) lets the receiver
  decide, from data alone (the frozen `exSnapshot` + whatever is already logged), whether a tap is
  valid and what the next pending set is, without needing history or progression logic (that stays
  JS-only: `pushNotificationState()` now also sends a full per-exercise suggested-reps lookahead
  table - every exercise with pending sets, not just the current one - see `app.js`).
- A native "commits since the last JS sync" cache (`ActionQueue`'s `nativeCommits`) is what the
  notification's projection is actually computed from while backgrounded; `saveLastState` prunes it
  against every fresh push from JS, which is what stops a native commit that has since actually
  been reconciled (or an in-app change, e.g. an undo) from silently diverging from the truth.
- `core.js`'s `reconcileActions` is still the **only** thing that ever writes to
  `session.log`/`localStorage` - it re-validates every native-approved action from scratch using
  the session's own `exSnapshot` (defense in depth, not trust), and nothing is ever deleted from
  the durable queue before that reconciliation's resulting save has actually succeeded (unchanged
  from 2A.1/2B.2 - see the storage-failure tests).
- A real rest countdown starts immediately (native-tracked deadline, independent of `session.rest`
  until JS catches up) and a `Handler`-based timer proactively advances the notification to the
  next pending set the moment it expires, with no user interaction and no WebView involvement.

**What remains queue-and-wait (not instant):** Pause/Resume of the **whole workout** still only
enqueues and shows "…Updating…" until core.js reconciles it, because only core.js tracks
`session.pausedMs` (the elapsed-time bookkeeping) - replicating that natively was judged not worth
the added duplication for a less time-critical action. A weight **adjustment** (before Log Set is
tapped) was already, and remains, purely local/native - it never touches the durable queue at all,
by design, since an adjustment that's never committed has nothing for core.js to know about.

**Honest, remaining limits on "true background logging":**
- The proactive rest-expiry `Handler` only survives as long as this `Service` instance does.
  Android does not impose Doze/background-execution limits on an *active* foreground service's own
  callbacks, but some OEMs (Samsung included) are known to aggressively kill foreground services
  under battery-saver modes regardless of what the platform API guarantees - **not verified on a
  real device.** If the callback never fires, the notification's own defensive deadline check
  still corrects the display the next time anything rebuilds it (another tap, or the app
  reopening) - just not proactively, i.e. the countdown could sit at "0:00" a little longer than it
  should before flipping to the next set.
- If the foreground service's process is killed entirely (not just the Handler failing) between a
  native commit and the next notification rebuild, the committed set itself is still safe (it was
  already durably written via `commit()`) - but the notification will not show the advanced state
  again until something restarts the service (JS pushing fresh state, or another action tap).
- Reps are still not adjustable from the notification (see below) - this is unchanged from 2B.2.

The notification is a quick-logging controller, not just a readout. See `core.test.js` for the
logset-specific idempotency/validation tests (duplicate taps on an already-logged set, a
wrong-session or stale action, an exercise not in the session's own snapshot, and an invalid
weight/reps all get rejected without corrupting the log) and `WorkoutLogicTest.java` (a plain JUnit
test, run via `./gradlew testDebugUnitTest`) for the native-side mirror of that same logic.

**Deliberate design choice - no custom `RemoteViews` layout:** a plain `NotificationCompat`
notification (used throughout this app) only reliably supports about 3 action buttons, and there
is no simple way to fit "Log Set" + increase/decrease weight + adjust reps + Pause + Skip all at
once without a custom expanded layout. This phase intentionally does **not** add one: a custom
`RemoteViews` layout's colors are not guaranteed to match the system's light/dark notification
theme the way `NotificationCompat`'s own text views are (a well-known, easy-to-get-wrong pitfall -
invisible text on some OEM theme combinations), and that is exactly the kind of per-device
rendering risk this environment has no way to verify without a real phone. Instead, each
notification state shows the 2-3 actions that matter most for it, and anything else is one tap
away via the notification's own content-tap (opens the app):
- **ready** (a set is pending): `-{increment}`, `Log set`, `+{increment}` - weight-only quick
  adjust, using the exercise's own configured increment; reps are not adjustable from the
  notification in this version (3-button budget; adjusting reps still works fine inside the app).
  The adjustment itself is purely local/native (SharedPreferences `pendingAdjust`, never the
  durable action queue) until "Log set" is tapped, so an adjustment that's never committed can
  never desync from or corrupt the session - the worst case is it silently resets to the suggested
  load next time, never a wrong value actually recorded.
- **resting** / **rest_paused**: `Skip rest`, `Pause rest`/`Resume rest`, `Pause workout`.
- **exercise_complete** (every set logged): `Finish workout`, `Pause workout`.
- **workout_paused**: `Resume workout`.

**Known limitations, not verified on a device:**
- The exact button layout/spacing above is standard Android notification actions, which Samsung's
  One UI is known to sometimes order or collapse differently from Pixel's (same caveat as 2A/2A.1's
  Pause/Skip rest buttons already had) - not confirmed on a Samsung device.
- Rep adjustment and simultaneous weight-decrease-and-increase in one glance are not available
  from the notification at all (only from inside the app) - a direct consequence of the 3-button
  ceiling, not an oversight.
- The weight-adjustment buttons' tap-to-redraw latency (native-only, no WebView round-trip) has
  not been measured on a real device; it should be near-instant since it never waits on the
  WebView, but "near-instant" has not been timed.
- Lock-screen visibility of the new action buttons (and whether Android trims any of them on the
  lock screen specifically, which is a known OS behavior for notifications with many actions) has
  not been checked.
- **Pre-existing, not introduced this phase:** Android's `Chronometer` in countdown mode has no
  built-in "stop at zero" behavior - once `restDeadlineEpochMs` passes, it keeps counting into
  negative numbers unless the notification is rebuilt with a different mode. The in-app rest
  widget already clamps this correctly (`restRemainingMs` never goes negative), but the
  *notification's own* Chronometer relies on `pushNotificationState()` being called again once
  rest actually ends to switch it out of countdown mode - which happens, but only after up to a
  ~7-second grace window (the same "Go" window the in-app timer already shows) during which the
  native countdown could plausibly be seen ticking slightly past zero. Not confirmed on a device.

## Phase 2B.4 hotfix: the rest countdown was missing from the notification entirely

Real-device testing found the rest countdown worked in-app but never appeared in the
notification. Root cause: `WorkoutForegroundService.onStartCommand`'s `ACTION_SHOW` handling
(every fresh push from JS, i.e. every normal `render()`) **unconditionally cleared**
`nativeRest` instead of establishing it from what JS actually sent. `buildActiveNotification()`
decides "is resting" purely from `nativeRest` - never from the pushed payload's own
`restActive`/`restDeadlineEpochMs`/`restPaused` fields - so a rest started from the **in-app**
UI (as opposed to a Log Set tap *on the notification itself*, which is the only thing that ever
populated `nativeRest`) was invisible to the notification 100% of the time.

**Fixed:** `syncNativeRestFromJsState` now establishes (or correctly clears) `nativeRest` from
the pushed state every time, via a new pure, unit-tested helper (`WorkoutLogic.syncRestFromState`
- see `WorkoutLogicTest.java`). This also means the native Pause/Resume/Skip rest button
handlers (which only ever read `nativeRest`) now work correctly for an app-started rest too,
and the proactive rest-expiry `Handler` (`scheduleRestExpiryIfNeeded`) now fires for those as
well, not only for notification-started rests.

**Wall-clock vs. elapsed-realtime:** both JS (`Date.now()`) and this native code
(`System.currentTimeMillis()`) already use the same wall-clock epoch-millisecond basis
throughout, including the fixed `nativeRest.deadline` value - no conversion was needed there.
The one place a *different* clock genuinely matters is Android's own `Chronometer` widget:
`setUsesChronometer(true)` with a wall-clock `setWhen()` relies on Android's documented internal
conversion (`base = when + (elapsedRealtime() - currentTimeMillis())`, recomputed every time the
notification is rebuilt) to turn that wall-clock value into its internal elapsed-realtime-based
stopwatch base. That conversion is standard `NotificationCompat`/`Notification` behavior, not
something this app implements itself, and was already being relied on correctly before this fix
- the missing piece was only ever getting `nativeRest` populated in the first place.

**Genuine Samsung One UI limitations (still not verified on a device):** One UI has been
reported (elsewhere, not confirmed by this project) to be more aggressive than stock Android
about trimming background work for apps under its "Put unused apps to sleep"/battery-saver
modes, which could still kill this foreground service's process between notification rebuilds
even with the above fix - in that case the countdown would only catch up the next time
anything rebuilds the notification (another tap, or the JS side pushing a fresh state), not
proactively. One UI is also known to sometimes order/collapse notification action buttons
differently from Pixel's (the same caveat 2A/2A.1/2B.3 already noted for the other action
buttons). Neither of these has been exercised on a real Samsung device by this project.

## Real-device checklist

Nothing below has been run on an actual phone from this change — only read through carefully and
reasoned about. Go through this on a Samsung Android phone (and ideally a Pixel too) before
trusting it:

- [ ] Fresh install, grant notification permission when asked, start a workout, lock the phone.
- [ ] Open the notification shade: title, elapsed time (ticking), current exercise, sets done,
      Pause/Resume button all show correctly.
- [ ] Log a set that starts a rest timer: the notification switches to a ticking rest countdown
      and a "Skip rest" button appears.
- [ ] Tap Pause/Resume on the notification while the app is backgrounded: it should show
      "Updating…" immediately, then settle to the correct Paused/Active state within a second or
      two of reopening the app (not stay stuck on the tapped label indefinitely).
- [ ] Tap Skip rest on the notification; confirm the countdown doesn't linger at 0:00 afterwards.
- [ ] Pause/resume/skip rest from the in-app rest-timer widget (not the notification) and confirm
      the notification updates too, not just the in-app widget.
- [ ] Tap the notification body — it opens V-Shape to the right workout.
- [ ] Finish a workout, then start another workout of the *same* program day later the same day —
      confirm it starts a genuinely new, empty session rather than reopening the finished one, and
      that the finished workout's sets are still visible in Progress/history afterwards.
- [ ] Switch to another app (e.g. YouTube Music) and back — the V-Shape notification is still
      correct and YouTube Music's own notification is unaffected.
- [ ] Leave V-Shape in the background for several minutes, then bring it back — elapsed time and
      rest countdown are still accurate (they're deadline-based, not a JS counter that drifts).
- [ ] Kill the app process (not just background it) with an active workout, then reopen it — the
      workout is restored, no sets are lost, and the notification comes back.
- [ ] Deny the notification permission on a fresh install — the workout still logs sets and the
      rest timer still works inside the app; no crash, no repeated permission nagging.
- [ ] Finish a workout (with the confirmation prompt) and confirm the notification clears and the
      foreground service stops.
- [ ] Check that elapsed time and the final set history for that workout look right afterwards.
- [ ] The Health Connect permission screen and sync accuracy against Samsung Health.
- [ ] Phone-plus-watch step totals (make sure they aren't double-counted).
- [ ] The Android 14 Health Connect permission-usage entry (`ViewPermissionUsageActivity`).
- [ ] Backup export: Android WebView doesn't support blob downloads directly, so this uses the
      share sheet / download manager fallback already in the app — confirm it still produces a
      usable file on your device.
- [ ] The minus key on the on-screen keyboard for assisted pull-up weight entry.

### Phase 2B.2 - smart notification quick-logging
- [ ] Start a workout; the notification shows the exercise, set number, and suggested weight/reps.
- [ ] Tap `+{increment}`/`-{increment}` on the notification a few times; the displayed weight
      updates immediately (no "Updating…" - this is a local redraw, not a queued action) and never
      goes below whatever `validateSet` would reject once logged.
- [ ] Tap `Log set`: confirm the exact weight shown (including after an adjustment) is what ends
      up recorded in the app, not the original suggestion; the notification then switches to the
      rest countdown automatically.
- [ ] Rapidly double-tap `Log set` (or tap it, then tap it again before the "Updating…" clears):
      confirm only one set gets logged, not two, and the app never shows a duplicated/corrupted set.
- [ ] While resting, tap `Pause rest` then `Resume rest` from the notification: confirm the
      countdown actually pauses/resumes (not just the button label) and matches the in-app timer.
- [ ] Log every planned set of an exercise; confirm the notification moves on to the next exercise
      automatically (no action needed) with a fresh suggested weight/reps for it.
- [ ] Log every set of the whole workout; confirm the notification shows "Finish workout" and
      tapping it actually finishes the session (check Progress/history afterwards).
- [ ] With the workout notification showing, edit the *same* workout's exercises from Settings >
      Workout plans while the workout stays open in another tab; confirm the notification and the
      in-progress session keep showing what was true when the workout started, not the edit.
- [ ] Kill the app process with a pending (not yet logged) set adjusted but not yet tapped "Log
      set"; reopen the app - confirm nothing was silently recorded, and the notification's
      adjustment either carries over cleanly or safely resets to the suggestion (never a wrong
      committed value).

### Phase 2B.3 - true background logging (the critical scenario)
- [ ] Start a workout, then lock the phone (screen off) or switch to another app entirely -
      do not reopen VShape for the rest of this checklist until told to.
- [ ] From the locked screen or the notification shade, tap `-`/`+` to adjust weight, then
      `Log set`. Confirm the notification immediately shows "Rest" with a real counting-down
      timer - no "Updating…" lingering, no delay waiting for anything.
- [ ] Wait for rest to finish without touching the phone. Confirm the notification automatically
      switches to the next pending set (or the next exercise, if that was the last set of the
      current one) with its own fresh suggested weight/reps, with no interaction at all.
- [ ] Repeat Log Set -> rest -> auto-advance for several more sets, still without opening the app,
      including at least one exercise boundary and the very last set of the whole workout
      (confirm "Finish workout" appears and tapping it actually ends the session instantly, not
      "Updating…").
- [ ] Only now reopen VShape. Confirm every set logged while backgrounded is present, in order,
      with the exact weights/reps that were shown on the notification at the time - not the
      original suggestions if they were adjusted.
- [ ] Repeat the above but kill the app process (not just background it) immediately after a
      Log Set tap, before reopening. Confirm that set survived (it's in the log once reopened)
      and nothing is duplicated.
- [ ] Repeat again, but this time force-stop background data/enable aggressive battery
      optimization for VShape (Samsung One UI's "Put unused apps to sleep" / "Deep sleeping apps")
      before locking the screen, then log a set and wait for rest to expire without touching the
      phone. This is the scenario most likely to break the proactive auto-advance (see the
      Handler/foreground-service caveat above) - confirm whether it still works, and if not,
      confirm the notification still self-corrects the next time it's tapped or the app reopens
      (it should never show a stale/finished countdown as still running indefinitely).
- [ ] While backgrounded with a rest countdown running, tap `Pause rest`, wait several seconds,
      then tap `Resume rest`: confirm the remaining time is preserved correctly (not reset, not
      continuing to tick while "paused").
- [ ] Double-tap `Log set` as fast as possible (or tap it twice in quick succession before any
      visual change): confirm exactly one set is recorded.
- [ ] Samsung-specific: confirm the notification's 3 action buttons render and remain tappable
      from the lock screen exactly as they do from the unlocked notification shade, and that One
      UI does not reorder/collapse them unpredictably between the two.

## After editing the web files
Run `npm run android` again (or `npm run build && npx cap sync android`) and re-run from Android Studio.
