'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

/* ---------- validation ---------- */
test('validateSet rejects non-finite weight and reps', () => {
  assert.equal(C.validateSet({}, { w: NaN, r: 5 }).ok, false);
  assert.equal(C.validateSet({}, { w: 10, r: Infinity }).ok, false);
  assert.equal(C.validateSet({}, { w: 10, r: 5.5 }).ok, false);
  assert.equal(C.validateSet({}, { w: 10, r: 0 }).ok, false);
});
test('validateSet rejects negative weight unless assisted', () => {
  assert.equal(C.validateSet({ assisted: false }, { w: -5, r: 8 }).ok, false);
  assert.equal(C.validateSet({ assisted: true }, { w: -5, r: 8 }).ok, true);
});
test('validateSet accepts a normal set', () => {
  assert.equal(C.validateSet({}, { w: 20, r: 10 }).ok, true);
});

test('sanitizeBodyWeightKg rejects out-of-range and non-numeric values', () => {
  assert.equal(C.sanitizeBodyWeightKg('abc'), null);
  assert.equal(C.sanitizeBodyWeightKg(10), null);
  assert.equal(C.sanitizeBodyWeightKg(300), null);
  assert.equal(C.sanitizeBodyWeightKg('70.25'), 70.3);
});
test('sanitizeStepCount bounds and rounds', () => {
  assert.equal(C.sanitizeStepCount(-1), null);
  assert.equal(C.sanitizeStepCount(200000), null);
  assert.equal(C.sanitizeStepCount('1234.6'), 1234);
});
test('sanitizeMacroEntry rejects negative or non-finite macros', () => {
  assert.equal(C.sanitizeMacroEntry({ k: -1, p: 1, c: 1, f: 1 }), null);
  assert.equal(C.sanitizeMacroEntry({ k: 'x', p: 1, c: 1, f: 1 }), null);
  assert.ok(C.sanitizeMacroEntry({ k: 100, p: 5, c: 10, f: 2 }));
});
test('isValidPhotoDataUri only accepts well-formed base64 image URIs', () => {
  assert.equal(C.isValidPhotoDataUri('<script>alert(1)</script>'), false);
  assert.equal(C.isValidPhotoDataUri('data:text/html,<script>'), false);
  assert.equal(C.isValidPhotoDataUri('data:image/jpeg;base64,/9j/4AAQSkZJRg=='), true);
});

/* ---------- sessions ---------- */
test('newSession starts active with zero paused time', () => {
  const s = C.newSession('push', 1000);
  assert.equal(s.status, 'active');
  assert.equal(s.startedAt, 1000);
  assert.equal(s.pausedMs, 0);
});
test('pause/resume accumulates paused time and elapsed excludes it', () => {
  const s = C.newSession('push', 0);
  C.pauseSession(s, 1000);
  assert.equal(s.status, 'paused');
  C.resumeSession(s, 4000);
  assert.equal(s.status, 'active');
  assert.equal(s.pausedMs, 3000);
  assert.equal(C.sessionElapsedMs(s, 10000), 7000);
});
test('resumeSession is a no-op when not paused', () => {
  const s = C.newSession('push', 0);
  C.resumeSession(s, 500);
  assert.equal(s.status, 'active');
  assert.equal(s.pausedMs, 0);
});
test('finishSession from paused folds remaining pause time and locks state', () => {
  const s = C.newSession('push', 0);
  C.pauseSession(s, 1000);
  C.finishSession(s, 1500);
  assert.equal(s.status, 'finished');
  assert.equal(s.pausedMs, 500);
  assert.equal(s.finishedAt, 1500);
  assert.equal(C.sessionElapsedMs(s, 999999), 1000);
});
test('finishSession never clears logged sets', () => {
  const s = C.newSession('push', 0);
  C.logSetIntoSession(s, { id: 'incline-db', sets: 3 }, 0, { w: 20, r: 8 });
  C.finishSession(s, 100);
  assert.deepEqual(s.log['incline-db'][0], { w: 20, r: 8 });
});

test('findOpenSession finds the active or paused session, ignoring finished ones', () => {
  const day = { sessions: [C.newSession('push', 0), C.newSession('pull', 10)] };
  C.finishSession(day.sessions[0], 20);
  const open = C.findOpenSession(day);
  assert.equal(open.day, 'pull');
});

/* ---------- same-day repeated sessions / finished-session immutability ---------- */
test('findOpenSessionForDay ignores a finished session for that same program day', () => {
  const day = { sessions: [C.newSession('push', 0)] };
  C.finishSession(day.sessions[0], 1000);
  assert.equal(C.findOpenSessionForDay(day, 'push'), null);
  assert.equal(C.findLastSessionForDay(day, 'push'), day.sessions[0]);
});
test('decideSessionStart creates a brand-new session instead of reusing a finished one for the same program day', () => {
  const day = { sessions: [C.newSession('push', 0)] };
  C.finishSession(day.sessions[0], 1000);
  const decision = C.decideSessionStart(day, 'push', null);
  assert.equal(decision.action, 'create');
});
test('decideSessionStart reuses an existing open session for the same program day instead of creating a duplicate', () => {
  const day = { sessions: [C.newSession('push', 0)] };
  const decision = C.decideSessionStart(day, 'push', day.sessions[0]);
  assert.equal(decision.action, 'reuse');
  assert.equal(decision.session, day.sessions[0]);
});
test('decideSessionStart blocks starting a second concurrent workout while another one is globally open', () => {
  const day = { sessions: [] };
  const otherOpenSession = C.newSession('pull', 0);
  const decision = C.decideSessionStart(day, 'push', otherOpenSession);
  assert.equal(decision.action, 'blocked');
  assert.equal(decision.blockingSession, otherOpenSession);
});
test('decideSessionStart allows a fresh start when no sessions exist yet for that day at all', () => {
  const day = { sessions: [] };
  const decision = C.decideSessionStart(day, 'push', null);
  assert.equal(decision.action, 'create');
});

/* ---------- logging / undo, shared-exercise isolation across sessions ---------- */
test('logSetIntoSession validates before writing', () => {
  const s = C.newSession('push', 0);
  const r = C.logSetIntoSession(s, { id: 'x' }, 0, { w: NaN, r: 5 });
  assert.equal(r.ok, false);
  assert.equal(s.log.x, undefined);
});
test('undoSetInSession clears a single entry and removes empty arrays', () => {
  const s = C.newSession('push', 0);
  C.logSetIntoSession(s, { id: 'x' }, 0, { w: 10, r: 5 });
  const u = C.undoSetInSession(s, 'x', 0);
  assert.equal(u.ok, true);
  assert.equal(s.log.x, undefined);
});
test('two sessions on the same date keep a shared exercise id isolated (the original bug)', () => {
  const pushSession = C.newSession('push', 0);
  const upperSession = C.newSession('upper', 0);
  C.logSetIntoSession(pushSession, { id: 'lat-raise' }, 0, { w: 5, r: 15 });
  C.logSetIntoSession(upperSession, { id: 'lat-raise' }, 0, { w: 7.5, r: 12 });
  assert.equal(pushSession.log['lat-raise'][0].w, 5);
  assert.equal(upperSession.log['lat-raise'][0].w, 7.5);
});

test('sessionSetsDone counts only logged sets for that session and volume excludes timed work', () => {
  const s = C.newSession('push', 0);
  const programDay = { ex: [{ id: 'a', sets: 2, timed: false }, { id: 'b', sets: 1, timed: true }] };
  C.logSetIntoSession(s, { id: 'a' }, 0, { w: 10, r: 8 });
  C.logSetIntoSession(s, { id: 'b' }, 0, { w: 0, r: 30 });
  const d = C.sessionSetsDone(s, programDay);
  assert.equal(d.done, 2);
  assert.equal(d.total, 3);
  assert.equal(d.vol, 80);
});

/* ---------- rest timer ---------- */
test('rest timer deadline-based countdown survives a pause/resume', () => {
  const s = C.newSession('push', 0);
  C.startRest(s, { id: 'a', name: 'A', rest: 90 }, 0);
  assert.equal(C.restRemainingMs(s, 30000), 60000);
  C.pauseRest(s, 30000);
  assert.equal(C.restRemainingMs(s, 90000), 60000);
  C.resumeRest(s, 90000);
  assert.equal(s.rest.deadline, 150000);
  assert.equal(C.restRemainingMs(s, 100000), 50000);
});
test('skipRest clears the rest state entirely', () => {
  const s = C.newSession('push', 0);
  C.startRest(s, { id: 'a', name: 'A', rest: 60 }, 0);
  C.skipRest(s);
  assert.equal(s.rest, null);
  assert.equal(C.restRemainingMs(s, 1000), null);
});
test('restRemainingMs never goes negative once the deadline has passed (no lingering stale countdown)', () => {
  const s = C.newSession('push', 0);
  C.startRest(s, { id: 'a', name: 'A', rest: 30 }, 0);
  assert.equal(C.restRemainingMs(s, 999999), 0);
});
test('finishing a session clears any in-progress rest', () => {
  const s = C.newSession('push', 0);
  C.startRest(s, { id: 'a', name: 'A', rest: 60 }, 0);
  C.finishSession(s, 1000);
  assert.equal(s.rest, null);
});

/* ---------- notification action reconciliation ---------- */
test('reconcileActions applies pause/resume/skip-rest in sequence order', () => {
  const s = C.newSession('push', 0);
  C.startRest(s, { id: 'a', name: 'A', rest: 60 }, 0);
  const { applied, skipped } = C.reconcileActions(s, [
    { seq: 2, type: 'pause', ts: 100 },
    { seq: 1, type: 'skip-rest', ts: 50 },
  ], 200);
  assert.equal(applied.length, 2);
  assert.equal(skipped.length, 0);
  assert.equal(s.rest, null);
  assert.equal(s.status, 'paused');
  assert.equal(s.lastAppliedSeq, 2);
});
test('reconcileActions skips duplicate and stale actions idempotently', () => {
  const s = C.newSession('push', 0);
  C.reconcileActions(s, [{ seq: 5, type: 'pause', ts: 0 }], 10);
  const second = C.reconcileActions(s, [{ seq: 5, type: 'pause', ts: 0 }, { seq: 3, type: 'resume', ts: 0 }], 20);
  assert.equal(second.applied.length, 0);
  assert.equal(second.skipped.length, 2);
  assert.equal(second.skipped[0].reason, 'stale-or-duplicate');
});
test('reconcileActions skips actions for the wrong session and unknown types', () => {
  const s = C.newSession('push', 0);
  const r = C.reconcileActions(s, [
    { seq: 1, type: 'pause', sessionId: 'not-this-one', ts: 0 },
    { seq: 2, type: 'bogus', ts: 0 },
  ], 10);
  assert.equal(r.applied.length, 0);
  assert.deepEqual(r.skipped.map(x => x.reason), ['session-mismatch', 'unknown-type']);
});
test('reconcileActions treats two concurrent taps of the same action as idempotent, not a double-apply', () => {
  const s = C.newSession('push', 0);
  const r = C.reconcileActions(s, [
    { seq: 1, type: 'pause', ts: 100 },
    { seq: 2, type: 'pause', ts: 200 },
  ], 300);
  assert.equal(r.applied.length, 2); // both are legitimately newer than lastAppliedSeq when fetched together
  assert.equal(s.status, 'paused');
  assert.equal(s.pausedAt, 100); // the second pause is a no-op once already paused; it doesn't reset the clock
});
test('reconcileActions skips every action once the session is finished', () => {
  const s = C.newSession('push', 0);
  C.finishSession(s, 5);
  const r = C.reconcileActions(s, [{ seq: 1, type: 'pause', ts: 0 }], 10);
  assert.equal(r.applied.length, 0);
  assert.equal(r.skipped[0].reason, 'session-finished');
});
test('reconcileActions with no session skips everything without throwing', () => {
  const r = C.reconcileActions(null, [{ seq: 1, type: 'pause' }], 10);
  assert.equal(r.applied.length, 0);
  assert.equal(r.skipped[0].reason, 'no-session');
});

test('reconcileActions never silently drops an action: every one ends up applied or skipped', () => {
  const s = C.newSession('push', 0);
  const actions = [{ seq: 1, type: 'bogus' }, { seq: 2, type: 'pause', ts: 0 }, { seq: 3, sessionId: 'not-this-session', type: 'resume' }];
  const r = C.reconcileActions(s, actions, 10);
  assert.equal(r.applied.length + r.skipped.length, actions.length);
});
test('reconcileActions is a no-op pass when the batch is empty', () => {
  const s = C.newSession('push', 0);
  const r = C.reconcileActions(s, [], 10);
  assert.equal(r.applied.length, 0);
  assert.equal(r.skipped.length, 0);
});

test('shouldShowNotification is true only for active/paused sessions', () => {
  assert.equal(C.shouldShowNotification(null), false);
  const s = C.newSession('push', 0);
  assert.equal(C.shouldShowNotification(s), true);
  C.finishSession(s, 10);
  assert.equal(C.shouldShowNotification(s), false);
});

/* ---------- active-session restoration / process-death recovery ---------- */
test('an active session round-trips through JSON (simulated process death) with elapsed time intact', () => {
  const s = C.newSession('push', 0);
  C.logSetIntoSession(s, { id: 'a' }, 0, { w: 10, r: 8 });
  C.pauseSession(s, 1000);
  const revived = JSON.parse(JSON.stringify(s));
  assert.equal(revived.status, 'paused');
  assert.equal(C.sessionElapsedMs(revived, 999999), 1000);
  assert.deepEqual(revived.log.a[0], { w: 10, r: 8 });
});

/* ---------- progression suggestions ---------- */
test('suggestProgression gives a first-time starting weight with no history', () => {
  const ex = { sets: 3, lo: 6, hi: 10, inc: 2, start: 18, timed: false };
  const sg = C.suggestProgression(ex, []);
  assert.equal(sg.first, true);
  assert.equal(sg.w, 18);
  assert.deepEqual(sg.reps, [6, 6, 6]);
});
test('suggestProgression adds load once every set hits the top of the range', () => {
  const ex = { sets: 2, lo: 8, hi: 12, inc: 2, start: 10, timed: false };
  const hist = [{ d: '2026-01-01', sets: [{ w: 10, r: 12 }, { w: 10, r: 12 }] }];
  const sg = C.suggestProgression(ex, hist);
  assert.equal(sg.up, true);
  assert.equal(sg.w, 12);
});
test('suggestProgression increases assistance (more negative weight) for an assisted lift that misses its rep range', () => {
  const ex = { sets: 2, lo: 6, hi: 10, inc: 2.5, start: 0, bw: true, assisted: true };
  const hist = [{ d: '2026-01-01', sets: [{ w: -10, r: 4 }, { w: -10, r: 4 }] }];
  const sg = C.suggestProgression(ex, hist);
  assert.equal(sg.w, -12.5);
});
test('suggestProgression does not drive a non-assisted bodyweight lift negative when reps fall short', () => {
  const ex = { sets: 2, lo: 10, hi: 15, inc: 0, start: 0, bw: true };
  const hist = [{ d: '2026-01-01', sets: [{ w: 0, r: 6 }, { w: 0, r: 6 }] }];
  const sg = C.suggestProgression(ex, hist);
  assert.equal(sg.w, 0);
});

test('isPR is true only when the current session beats every prior session', () => {
  const ex = { timed: false, bw: false };
  const hist = [{ d: '2026-01-01', sets: [{ w: 20, r: 8 }] }];
  assert.equal(C.isPR(ex, hist, [{ w: 22, r: 8 }]), true);
  assert.equal(C.isPR(ex, hist, [{ w: 18, r: 8 }]), false);
});

/* ---------- migration ---------- */
test('migrateBlob turns a v1 day with logged sets into one finished session, invents nothing', () => {
  const raw = { profile: { targets: { kcal: 2000 } }, days: { '2026-01-01': { date: '2026-01-01', food: [], steps: 5000, w: { day: 'push', log: { 'incline-db': [{ w: 20, r: 8 }] } } } } };
  const out = C.migrateBlob(raw);
  assert.equal(out.schema, C.SCHEMA_VERSION);
  assert.equal(out.migrated, true);
  assert.equal(out.plans, null); // no plans existed yet; the app seeds a default plan on load
  const day = out.days['2026-01-01'];
  assert.equal(day.sessions.length, 1);
  assert.equal(day.sessions[0].day, 'push');
  assert.equal(day.sessions[0].status, 'finished');
  assert.equal(day.sessions[0].startedAt, null);
  assert.deepEqual(day.sessions[0].log['incline-db'], [{ w: 20, r: 8 }]);
});
test('migrateBlob leaves a day with no workout log with zero sessions', () => {
  const raw = { profile: {}, days: { '2026-01-02': { date: '2026-01-02', food: [], steps: 0, w: { day: null, log: {} } } } };
  const out = C.migrateBlob(raw);
  assert.equal(out.days['2026-01-02'].sessions.length, 0);
});
test('migrateBlob upgrades already session-shaped schema-2 data to schema 3 without altering days or sessions', () => {
  const raw = { schema: 2, profile: { a: 1 }, days: { x: { sessions: [{ id: 's1', day: 'push', status: 'finished', log: {} }] } } };
  const out = C.migrateBlob(raw);
  assert.equal(out.schema, C.SCHEMA_VERSION);
  assert.equal(out.migrated, true);
  assert.equal(out.plans, null);
  assert.deepEqual(out.profile, { a: 1 });
  assert.deepEqual(out.days.x.sessions, raw.days.x.sessions);
});
test('migrateBlob is a no-op (just passthrough) for data already on the current schema, plans included', () => {
  const raw = { schema: C.SCHEMA_VERSION, profile: { a: 1 }, days: { x: { sessions: [] } }, plans: [{ id: 'p1', name: 'X', days: [] }], activePlanId: 'p1' };
  const out = C.migrateBlob(raw);
  assert.equal(out.migrated, false);
  assert.deepEqual(out.profile, { a: 1 });
  assert.deepEqual(out.plans, raw.plans);
  assert.equal(out.activePlanId, 'p1');
});
test('migrateBlob refuses (locks) data from a newer schema instead of flattening it', () => {
  const out = C.migrateBlob({ schema: 99, profile: {}, days: {} });
  assert.equal(out.locked, true);
  assert.equal(out.schemaFound, 99);
});

/* ---------- workout plans ---------- */
test('createPlan appends a new empty plan and duplicatePlan copies it with fresh plan/day ids but the same exercise ids', () => {
  const plans = [];
  const p = C.createPlan(plans, 'Push A', 1000);
  const day = C.newPlanDay('Day 1', 1000);
  C.addExerciseToDay(day, { id: 'incline-db', name: 'Incline DB Press', sets: 3, muscle: 'Chest' });
  C.addDayToPlan(p, day);
  const copy = C.duplicatePlan(plans, p.id, 'Push A copy', 2000);
  assert.equal(plans.length, 2);
  assert.notEqual(copy.id, p.id);
  assert.notEqual(copy.days[0].id, day.id);
  assert.equal(copy.days[0].ex[0].id, 'incline-db'); // exercise identity preserved for progression history
  copy.days[0].name = 'Changed';
  assert.notEqual(p.days[0].name, 'Changed'); // editing the copy never touches the original
});
test('deletePlan refuses to remove the last remaining plan', () => {
  const plans = [C.newPlan('Only', 0)];
  const r = C.deletePlan(plans, plans[0].id, plans[0].id);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'last-plan');
  assert.equal(plans.length, 1);
});
test('deletePlan removes a non-active plan without touching which plan is active', () => {
  const plans = [C.newPlan('A', 0), C.newPlan('B', 1)];
  const r = C.deletePlan(plans, plans[1].id, plans[0].id);
  assert.equal(r.ok, true);
  assert.equal(r.newActivePlanId, undefined);
  assert.equal(plans.length, 1);
});
test('deletePlan removing the active plan hands back a new active plan id', () => {
  const plans = [C.newPlan('A', 0), C.newPlan('B', 1)];
  const r = C.deletePlan(plans, plans[0].id, plans[0].id);
  assert.equal(r.ok, true);
  assert.equal(r.newActivePlanId, plans[0].id); // plans[1] ('B') shifted into index 0 after splice
});
test('addExerciseToDay/removeExerciseFromDay/moveExerciseInDay manage a day exercise list in place', () => {
  const day = C.newPlanDay('Day', 0);
  C.addExerciseToDay(day, { id: 'a', name: 'A' });
  C.addExerciseToDay(day, { id: 'b', name: 'B' });
  assert.deepEqual(day.ex.map(e => e.id), ['a', 'b']);
  assert.equal(C.moveExerciseInDay(day, 'b', -1), true);
  assert.deepEqual(day.ex.map(e => e.id), ['b', 'a']);
  assert.equal(C.moveExerciseInDay(day, 'b', -1), false); // already first
  assert.equal(C.removeExerciseFromDay(day, 'a'), true);
  assert.deepEqual(day.ex.map(e => e.id), ['b']);
});
test('substituteExerciseInDay replaces an exercise in place, keeping its position', () => {
  const day = C.newPlanDay('Day', 0);
  C.addExerciseToDay(day, { id: 'a', name: 'A' });
  C.addExerciseToDay(day, { id: 'b', name: 'B' });
  C.substituteExerciseInDay(day, 'a', { id: 'c', name: 'C' });
  assert.deepEqual(day.ex.map(e => e.id), ['c', 'b']);
});
test('planDayForWeekday finds the training day scheduled for a given weekday and ignores rest days', () => {
  const plan = C.newPlan('P', 0);
  const push = C.newPlanDay('Push', 0); push.weekdays = [1];
  const rest = C.newPlanDay('Rest', 0); rest.rest = true; rest.weekdays = [1];
  C.addDayToPlan(plan, push); C.addDayToPlan(plan, rest);
  assert.equal(C.planDayForWeekday(plan, 1), push);
  assert.equal(C.planDayForWeekday(plan, 2), null);
});
test('newSession captures a plan/day snapshot that stays frozen after the source day is later edited', () => {
  const day = C.newPlanDay('Push', 0);
  C.addExerciseToDay(day, { id: 'incline-db', name: 'Incline DB Press', sets: 3, muscle: 'Chest' });
  const s = C.newSession('d1', 0, null, { planId: 'p1', dayId: day.id, dayName: day.name, exSnapshot: JSON.parse(JSON.stringify(day.ex)) });
  day.ex[0].name = 'Renamed Press'; // simulate a later plan edit
  assert.equal(s.exSnapshot[0].name, 'Incline DB Press');
  assert.equal(s.dayName, 'Push');
  assert.equal(s.planId, 'p1');
});
test('weeklyVolumeByMuscle sums logged volume per muscle group from each session\'s own snapshot, excluding timed work', () => {
  const s1 = C.newSession('d1', 0, null, { exSnapshot: [{ id: 'a', muscle: 'Chest', timed: false }, { id: 'b', muscle: 'Legs', timed: true }] });
  C.logSetIntoSession(s1, { id: 'a' }, 0, { w: 10, r: 8 });
  C.logSetIntoSession(s1, { id: 'b' }, 0, { w: 0, r: 30 });
  const s2 = C.newSession('d2', 0, null, { exSnapshot: [{ id: 'a', muscle: 'Chest', timed: false }] });
  C.logSetIntoSession(s2, { id: 'a' }, 0, { w: 20, r: 5 });
  const vol = C.weeklyVolumeByMuscle([s1, s2]);
  assert.equal(vol.Chest, 180);
  assert.equal(vol.Legs, undefined);
});
test('weeklyVolumeByMuscle is immune to the plan being edited after the session was logged', () => {
  const day = C.newPlanDay('Push', 0);
  C.addExerciseToDay(day, { id: 'a', name: 'A', muscle: 'Chest', timed: false });
  const s = C.newSession('d1', 0, null, { exSnapshot: JSON.parse(JSON.stringify(day.ex)) });
  C.logSetIntoSession(s, { id: 'a' }, 0, { w: 10, r: 10 });
  day.ex[0].muscle = 'Shoulders'; // edit the live plan afterwards
  const vol = C.weeklyVolumeByMuscle([s]);
  assert.equal(vol.Chest, 100);
  assert.equal(vol.Shoulders, undefined);
});

test('quarantineInvalidSets moves bad entries out without losing the day data, and cleans up empty logs', () => {
  const exlist = { a: { id: 'a', assisted: false } };
  const day = { sessions: [{ id: 's1', log: { a: [{ w: -5, r: 8 }, { w: 10, r: 8 }] } }], quarantine: { sets: [], food: [] } };
  C.quarantineInvalidSets(day, exlist);
  assert.equal(day.quarantine.sets.length, 1);
  assert.equal(day.quarantine.sets[0].reason, 'negative-weight-not-allowed');
  assert.deepEqual(day.sessions[0].log.a[1], { w: 10, r: 8 });
  assert.equal(day.sessions[0].log.a[0], null);
});
test('quarantineInvalidSets removes a log entry entirely once every set in it is invalid', () => {
  const exlist = { a: { id: 'a', assisted: false } };
  const day = { sessions: [{ id: 's1', log: { a: [{ w: -5, r: 8 }] } }], quarantine: { sets: [], food: [] } };
  C.quarantineInvalidSets(day, exlist);
  assert.equal(day.sessions[0].log.a, undefined);
});

/* ---------- backup parsing ---------- */
test('parseBackupJSON rejects malformed, foreign, or incomplete backups', () => {
  assert.equal(C.parseBackupJSON('not json').ok, false);
  assert.equal(C.parseBackupJSON(JSON.stringify({ app: 'other' })).ok, false);
  assert.equal(C.parseBackupJSON(JSON.stringify({ app: 'vshape-tracker', profile: {} })).ok, false);
});
test('parseBackupJSON accepts a well-formed backup', () => {
  const r = C.parseBackupJSON(JSON.stringify({ app: 'vshape-tracker', profile: {}, days: {} }));
  assert.equal(r.ok, true);
});

/* ---------- Health Connect transforms ---------- */
test('hcWeightToKg converts grams and pounds, and treats an unlabelled value as already kg', () => {
  assert.equal(C.hcWeightToKg({ value: 70000, unit: 'gram' }), 70);
  assert.equal(C.hcWeightToKg({ value: 70, unit: 'kilogram' }), 70);
  assert.equal(Math.round(C.hcWeightToKg({ value: 154, unit: 'pound' })), 70);
  assert.equal(C.hcWeightToKg({ value: 70 }), 70);
  assert.equal(C.hcWeightToKg(null), null);
});
test('hcEnergyToKcal converts kilojoules and raw calories to kcal', () => {
  assert.equal(Math.round(C.hcEnergyToKcal({ value: 418.4, unit: 'kilojoule' })), 100);
  assert.equal(C.hcEnergyToKcal({ value: 100000, unit: 'calories' }), 100);
  assert.equal(C.hcEnergyToKcal({ value: 100 }), 100);
});
test('hcPermissionState reads hasAllPermissions, a granted/requested array pair, or unknown shapes', () => {
  assert.equal(C.hcPermissionState({ hasAllPermissions: true }), 'granted');
  assert.equal(C.hcPermissionState({ hasAllPermissions: false }), 'denied');
  assert.equal(C.hcPermissionState({ granted: ['Steps'], requested: ['Steps', 'Weight'] }), 'denied');
  assert.equal(C.hcPermissionState({ granted: ['Steps', 'Weight'], requested: ['Steps', 'Weight'] }), 'granted');
  assert.equal(C.hcPermissionState({}), 'unknown');
  assert.equal(C.hcPermissionState(null), 'unknown');
});
test('mergeSteps sums per source per day and keeps the largest source so nothing double-counts', () => {
  const records = [
    { startTime: '2026-01-01T08:00:00Z', count: 2000, metadata: { dataOrigin: 'phone' } },
    { startTime: '2026-01-01T09:00:00Z', count: 1000, metadata: { dataOrigin: 'phone' } },
    { startTime: '2026-01-01T08:30:00Z', count: 5000, metadata: { dataOrigin: 'watch' } },
  ];
  const out = C.mergeSteps(records);
  assert.equal(out['2026-01-01'], 5000);
});
test('mergeWeights keeps only the latest reading per day and converts units', () => {
  // isoDay() buckets by local calendar day (correct - a late-night weigh-in
  // should count for the user's local "today"), so these use local-time Date
  // objects rather than hardcoded UTC strings: fixed UTC hours a day apart can
  // land on different local calendar days depending on the machine's timezone
  // (this broke under Australia/Sydney, UTC+11, during manual verification).
  const earlier = new Date(2026, 0, 1, 8, 0, 0).toISOString();
  const later = new Date(2026, 0, 1, 20, 0, 0).toISOString();
  const records = [
    { time: earlier, weight: { value: 70, unit: 'kilogram' } },
    { time: later, weight: { value: 69500, unit: 'gram' } },
  ];
  const out = C.mergeWeights(records);
  assert.equal(out['2026-01-01'], 69.5);
});
test('mergeWeights rejects an implausible out-of-range reading', () => {
  const records = [{ time: '2026-01-01T08:00:00Z', weight: { value: 9000, unit: 'gram' } }];
  const out = C.mergeWeights(records);
  assert.equal(out['2026-01-01'], undefined);
});

test('stepsApplyPolicy never overwrites a manually typed day but keeps refreshing phone-sourced days', () => {
  assert.deepEqual(C.stepsApplyPolicy({ steps: 0 }, 8000), { apply: true, source: 'phone' });
  assert.deepEqual(C.stepsApplyPolicy({ steps: 6000, stepsSource: 'manual' }, 8000), { apply: false, offerPhoneValue: 8000 });
  assert.deepEqual(C.stepsApplyPolicy({ steps: 6000, stepsSource: 'phone' }, 8000), { apply: true, source: 'phone' });
});
test('weightApplyPolicy only fills an empty day', () => {
  assert.equal(C.weightApplyPolicy(undefined).apply, true);
  assert.equal(C.weightApplyPolicy(70.2).apply, false);
});
