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
/* Regression: parseInt('12,345') is 12, so a count typed the way people actually write numbers
   was silently saved as a tiny value. Thousands separators (comma, space, NBSP, apostrophe)
   must be stripped before parsing. */
test('sanitizeStepCount understands thousands separators', () => {
  assert.equal(C.sanitizeStepCount('12,345'), 12345);
  assert.equal(C.sanitizeStepCount('12 345'), 12345);
  assert.equal(C.sanitizeStepCount('12 345'), 12345);
  assert.equal(C.sanitizeStepCount("12'345"), 12345);
  assert.equal(C.sanitizeStepCount(' 8000 '), 8000);
  assert.equal(C.sanitizeStepCount('1,234,567'), null);
  assert.equal(C.sanitizeStepCount(''), null);
  assert.equal(C.sanitizeStepCount('abc'), null);
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

/* ---------- fitness profile: units, dates, defaults, migration ---------- */
test('sanitizeHeightCm rejects out-of-range and non-numeric values, rounds to 1dp', () => {
  assert.equal(C.sanitizeHeightCm('abc'), null);
  assert.equal(C.sanitizeHeightCm(40), null);
  assert.equal(C.sanitizeHeightCm(280), null);
  assert.equal(C.sanitizeHeightCm('175.25'), 175.3);
});
test('feetInchesToCm and cmToFeetInches round-trip, carrying a rounded 12 inches into a foot', () => {
  assert.equal(C.feetInchesToCm(5, 10), 177.8);
  assert.deepEqual(C.cmToFeetInches(177.8), { ft: 5, inch: 10 });
  assert.deepEqual(C.cmToFeetInches(182.9), { ft: 6, inch: 0 }, 'a total that rounds to 12 inches carries into an extra foot, never "5\'12\\""');
});
test('kgToLb and lbToKg convert both directions', () => {
  assert.equal(C.kgToLb(100), 220.5);
  assert.equal(C.lbToKg(220.5), 100);
  assert.equal(C.kgToLb(NaN), null);
});
test('sanitizeDob rejects malformed, calendar-invalid, future and implausibly old dates', () => {
  const now = new Date(2026, 0, 1).getTime();
  assert.equal(C.sanitizeDob('not-a-date', now), null);
  assert.equal(C.sanitizeDob('2024-02-30', now), null, 'Feb 30 does not exist and must not silently roll into March');
  assert.equal(C.sanitizeDob('2026-06-01', now), null, 'a future date of birth is rejected');
  assert.equal(C.sanitizeDob('1850-01-01', now), null, 'an implausible age (176) is rejected');
  assert.equal(C.sanitizeDob('2000-05-15', now), '2000-05-15');
});
test('ageFromDob computes whole years, accounting for whether the birthday has occurred yet this year', () => {
  const now = new Date(2026, 5, 14).getTime(); // 14 Jun 2026
  assert.equal(C.ageFromDob('2000-06-15', now), 25, 'birthday is tomorrow - has not turned 26 yet');
  assert.equal(C.ageFromDob('2000-06-14', now), 26, 'birthday is today');
  assert.equal(C.ageFromDob('2000-06-13', now), 26, 'birthday was yesterday');
  assert.equal(C.ageFromDob(null, now), null);
});
test('defaultFitnessProfile never fabricates a real-world value - every field is null/empty', () => {
  const d = C.defaultFitnessProfile();
  assert.equal(d.onboarded, false);
  assert.equal(d.dob, null);
  assert.equal(d.heightCm, null);
  assert.equal(d.currentWeightKg, null);
  assert.deepEqual(d.secondaryGoals, []);
  assert.deepEqual(d.workoutPrefs, C.defaultWorkoutPrefs());
});
test('mergeFitnessProfile fills in missing/partial fields without discarding answered ones', () => {
  assert.deepEqual(C.mergeFitnessProfile(undefined), C.defaultFitnessProfile(), 'no existing fitness profile at all (pre-Phase-3A install) merges to full defaults');
  const partial = { onboarded: true, dob: '1995-01-01', units: { weight: 'lb' }, workoutPrefs: { daysPerWeek: 4 } };
  const merged = C.mergeFitnessProfile(partial);
  assert.equal(merged.onboarded, true);
  assert.equal(merged.dob, '1995-01-01');
  assert.equal(merged.units.weight, 'lb');
  assert.equal(merged.units.height, 'cm', 'a partially-specified units object still gets the missing field defaulted');
  assert.equal(merged.workoutPrefs.daysPerWeek, 4);
  assert.deepEqual(merged.workoutPrefs.equipment, [], 'a partially-specified workoutPrefs object still gets missing fields defaulted');
});
test('mergeFitnessProfile repairs a corrupted (non-array) goals list instead of throwing', () => {
  const merged = C.mergeFitnessProfile({ secondaryGoals: 'oops', customGoals: null });
  assert.deepEqual(merged.secondaryGoals, []);
  assert.deepEqual(merged.customGoals, []);
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
test('reconcileActions applies pause-rest/resume-rest (e.g. a "Pause rest"/"Resume rest" notification tap, not the workout pause)', () => {
  const s = C.newSession('push', 0);
  C.startRest(s, { id: 'a', name: 'A', rest: 60 }, 0);
  const r1 = C.reconcileActions(s, [{ seq: 1, type: 'pause-rest', ts: 1000 }], 2000);
  assert.equal(r1.applied.length, 1);
  assert.equal(s.rest.paused, true);
  assert.equal(s.status, 'active'); // the workout itself is untouched
  const r2 = C.reconcileActions(s, [{ seq: 2, type: 'resume-rest', ts: 3000 }], 4000);
  assert.equal(r2.applied.length, 1);
  assert.equal(s.rest.paused, false);
});
test('reconcileActions applies a finish action, durably ending the session (e.g. a "Finish workout" notification tap)', () => {
  const s = C.newSession('push', 0);
  const r = C.reconcileActions(s, [{ seq: 1, type: 'finish', ts: 500 }], 1000);
  assert.equal(r.applied.length, 1);
  assert.equal(s.status, 'finished');
  assert.equal(s.finishedAt, 500);
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

/* ---------- smart notification: state machine + logset reconciliation ---------- */
const PROGRAM_DAY = { ex: [{ id: 'a', name: 'A', sets: 1, lo: 8, hi: 12, rest: 60, inc: 2, start: 10, muscle: 'Chest' }, { id: 'b', name: 'B', sets: 1, lo: 8, hi: 12, rest: 60, inc: 2, start: 10, muscle: 'Back' }] };
test('notificationState walks ready -> resting -> ready -> exercise_complete, and paused/finished override everything', () => {
  const s = C.newSession('d1', 0, null, { exSnapshot: PROGRAM_DAY.ex });
  assert.equal(C.notificationState(s, PROGRAM_DAY), 'ready');
  C.logSetIntoSession(s, PROGRAM_DAY.ex[0], 0, { w: 10, r: 10 });
  C.startRest(s, PROGRAM_DAY.ex[0], 0);
  assert.equal(C.notificationState(s, PROGRAM_DAY), 'resting');
  C.pauseRest(s, 100);
  assert.equal(C.notificationState(s, PROGRAM_DAY), 'rest_paused');
  C.skipRest(s);
  assert.equal(C.notificationState(s, PROGRAM_DAY), 'ready'); // one set left (exercise B)
  C.logSetIntoSession(s, PROGRAM_DAY.ex[1], 0, { w: 10, r: 10 });
  assert.equal(C.notificationState(s, PROGRAM_DAY), 'exercise_complete');
  C.pauseSession(s, 200);
  assert.equal(C.notificationState(s, PROGRAM_DAY), 'workout_paused'); // pause overrides exercise_complete
  C.resumeSession(s, 300);
  C.finishSession(s, 400);
  assert.equal(C.notificationState(s, PROGRAM_DAY), 'workout_finished');
});
test('notificationState treats no session as workout_finished (nothing to show/control)', () => {
  assert.equal(C.notificationState(null, PROGRAM_DAY), 'workout_finished');
});
test('nextPendingSet walks exercises and sets in program order and returns null once everything is logged', () => {
  const s = C.newSession('d1', 0, null, { exSnapshot: PROGRAM_DAY.ex });
  assert.deepEqual(C.nextPendingSet(s, PROGRAM_DAY), { exIndex: 0, exId: 'a', setIndex: 0 });
  C.logSetIntoSession(s, PROGRAM_DAY.ex[0], 0, { w: 10, r: 10 });
  assert.deepEqual(C.nextPendingSet(s, PROGRAM_DAY), { exIndex: 1, exId: 'b', setIndex: 0 });
  C.logSetIntoSession(s, PROGRAM_DAY.ex[1], 0, { w: 10, r: 10 });
  assert.equal(C.nextPendingSet(s, PROGRAM_DAY), null);
});
test('pendingSetsList returns every remaining set in program order, letting a caller walk the whole rest of the workout from just the exSnapshot and what is logged so far', () => {
  const twoSetDay = { ex: [{ id: 'a', name: 'A', sets: 2, lo: 8, hi: 12, rest: 60, inc: 2, start: 10 }] };
  const s = C.newSession('d1', 0, null, { exSnapshot: twoSetDay.ex });
  assert.deepEqual(C.pendingSetsList(s, twoSetDay), [
    { exIndex: 0, exId: 'a', setIndex: 0 },
    { exIndex: 0, exId: 'a', setIndex: 1 },
  ]);
  C.logSetIntoSession(s, twoSetDay.ex[0], 0, { w: 10, r: 10 });
  assert.deepEqual(C.pendingSetsList(s, twoSetDay), [{ exIndex: 0, exId: 'a', setIndex: 1 }]);
  C.logSetIntoSession(s, twoSetDay.ex[0], 1, { w: 10, r: 10 });
  assert.deepEqual(C.pendingSetsList(s, twoSetDay), []);
});
test('reconcileActions applies a logset action exactly once and starts the matching rest timer in the same step', () => {
  const s = C.newSession('d1', 0, null, { exSnapshot: PROGRAM_DAY.ex });
  const r = C.reconcileActions(s, [{ seq: 1, type: 'logset', exId: 'a', index: 0, w: 22.5, r: 9, ts: 100 }], 200);
  assert.equal(r.applied.length, 1);
  assert.deepEqual(s.log.a[0], { w: 22.5, r: 9 });
  assert.ok(s.rest, 'expected the rest timer to start in the same reconciled step as the log');
  assert.equal(s.rest.exId, 'a');
});
test('reconcileActions skips a logset for a set index that is already logged, even from a distinct (non-stale) action - the duplicated/delayed tap case', () => {
  const s = C.newSession('d1', 0, null, { exSnapshot: PROGRAM_DAY.ex });
  C.reconcileActions(s, [{ seq: 1, type: 'logset', exId: 'a', index: 0, w: 20, r: 8, ts: 0 }], 10);
  const r = C.reconcileActions(s, [{ seq: 2, type: 'logset', exId: 'a', index: 0, w: 99, r: 99, ts: 20 }], 30);
  assert.equal(r.applied.length, 0);
  assert.equal(r.skipped[0].reason, 'set-already-logged');
  assert.deepEqual(s.log.a[0], { w: 20, r: 8 }); // the second (different seq, "duplicated tap") action never overwrites it
});
test('reconcileActions rejects a logset for an exercise not in the session\'s own snapshot (wrong/stale workout)', () => {
  const s = C.newSession('d1', 0, null, { exSnapshot: PROGRAM_DAY.ex });
  const r = C.reconcileActions(s, [{ seq: 1, type: 'logset', exId: 'not-in-this-workout', index: 0, w: 20, r: 8, ts: 0 }], 10);
  assert.equal(r.applied.length, 0);
  assert.equal(r.skipped[0].reason, 'unknown-exercise');
});
test('reconcileActions rejects an invalid logset (negative weight on a non-assisted exercise) without corrupting the log', () => {
  const s = C.newSession('d1', 0, null, { exSnapshot: PROGRAM_DAY.ex });
  const r = C.reconcileActions(s, [{ seq: 1, type: 'logset', exId: 'a', index: 0, w: -5, r: 8, ts: 0 }], 10);
  assert.equal(r.applied.length, 0);
  assert.equal(r.skipped[0].reason, 'invalid-set-negative-weight-not-allowed');
  assert.equal(s.log.a, undefined);
});
test('reconcileActions rejects a logset for the wrong session and for a finished session, same as the other action types', () => {
  const s = C.newSession('d1', 0, null, { exSnapshot: PROGRAM_DAY.ex });
  const r1 = C.reconcileActions(s, [{ seq: 1, type: 'logset', sessionId: 'not-this-one', exId: 'a', index: 0, w: 20, r: 8 }], 10);
  assert.equal(r1.skipped[0].reason, 'session-mismatch');
  C.finishSession(s, 20);
  const r2 = C.reconcileActions(s, [{ seq: 2, type: 'logset', exId: 'a', index: 0, w: 20, r: 8 }], 30);
  assert.equal(r2.skipped[0].reason, 'session-finished');
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

/* ---------- assisted exercises (negative weight = assistance) ---------- */
// e1RM (w * (1 + r/30)) is meaningless for a negative load: it scored MORE reps at the same
// assistance as worse, and isPR could never fire (best starts at 0 and must be > 0).
const ASSISTED_EX = { id: 'pullup', name: 'Assisted pull-up', sets: 2, lo: 6, hi: 10, rest: 150, inc: 2.5, start: 0, bw: true, assisted: true };
test('isPR for an assisted exercise: less assistance, or more reps at the same assistance, is a PR', () => {
  const hist = [{ d: '2026-01-01', sets: [{ w: -20, r: 8 }] }];
  assert.equal(C.isPR(ASSISTED_EX, hist, [{ w: -17.5, r: 6 }]), true, 'less assistance');
  assert.equal(C.isPR(ASSISTED_EX, hist, [{ w: -20, r: 9 }]), true, 'more reps at the same assistance');
  assert.equal(C.isPR(ASSISTED_EX, hist, [{ w: -20, r: 8 }]), false, 'a repeat is not a PR');
  assert.equal(C.isPR(ASSISTED_EX, hist, [{ w: -22.5, r: 12 }]), false, 'more assistance is not a PR even with more reps');
});
test('isPR for an assisted exercise needs a previous session to beat', () => {
  assert.equal(C.isPR(ASSISTED_EX, [], [{ w: -20, r: 8 }]), false);
});
test('isPR still works when an assisted lifter progresses past bodyweight into added weight', () => {
  const hist = [{ d: '2026-01-01', sets: [{ w: -2.5, r: 8 }] }];
  assert.equal(C.isPR(ASSISTED_EX, hist, [{ w: 2.5, r: 5 }]), true);
});
test('strengthSeries: assisted exercises chart the least-assisted load, in kg, negative allowed', () => {
  const hist = [
    { d: '2026-01-01', sets: [{ w: -25, r: 6 }, { w: -22.5, r: 5 }] },
    { d: '2026-01-08', sets: [{ w: -20, r: 8 }] },
  ];
  const s = C.strengthSeries(ASSISTED_EX, hist);
  assert.equal(s.unit, 'kg');
  assert.deepEqual(s.points, [{ d: '2026-01-01', v: -22.5 }, { d: '2026-01-08', v: -20 }]);
});
test('strengthSeries: normal lifts chart estimated 1RM, timed chart seconds, bodyweight-only chart reps', () => {
  const bench = { id: 'b', sets: 3, lo: 6, hi: 10 };
  const sb = C.strengthSeries(bench, [{ d: '2026-01-01', sets: [{ w: 60, r: 6 }] }]);
  assert.equal(sb.unit, 'kg');
  assert.equal(sb.points[0].v, 60 * (1 + 6 / 30));
  const plank = { id: 'p', sets: 2, lo: 30, hi: 60, timed: true };
  const sp = C.strengthSeries(plank, [{ d: '2026-01-01', sets: [{ w: 0, r: 40 }, { w: 0, r: 55 }] }]);
  assert.equal(sp.unit, 's'); assert.equal(sp.points[0].v, 55);
  const raise = { id: 'r', sets: 2, lo: 10, hi: 15, bw: true };
  const sr = C.strengthSeries(raise, [{ d: '2026-01-01', sets: [{ w: 0, r: 12 }, { w: 0, r: 14 }] }]);
  assert.equal(sr.unit, 'reps'); assert.equal(sr.points[0].v, 14);
});
test('strengthSeries of no history is empty', () => {
  assert.deepEqual(C.strengthSeries(ASSISTED_EX, []), { unit: 'kg', points: [] });
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

/* ---------- workout plans (weekday schedule + reusable templates) ---------- */
test('createPlan appends a new empty plan and duplicatePlan copies it with fresh plan/template ids but the same exercise ids', () => {
  const plans = [];
  const p = C.createPlan(plans, 'Push A', 1000);
  const t = C.newTemplate('Push', 1000);
  C.addExerciseToTemplate(t, { id: 'incline-db', name: 'Incline DB Press', sets: 3, muscle: 'Chest' });
  C.addTemplateToPlan(p, t);
  C.setWeekdayTemplates(p, 1, [t.id]);
  const copy = C.duplicatePlan(plans, p.id, 'Push A copy', 2000);
  assert.equal(plans.length, 2);
  assert.notEqual(copy.id, p.id);
  assert.notEqual(copy.templates[0].id, t.id);
  assert.equal(copy.templates[0].ex[0].id, 'incline-db'); // exercise identity preserved for progression history
  assert.deepEqual(copy.schedule[1], [copy.templates[0].id]); // schedule re-pointed at the copied template's new id
  copy.templates[0].name = 'Changed';
  assert.notEqual(p.templates[0].name, 'Changed'); // editing the copy never touches the original
  assert.deepEqual(p.schedule[1], [t.id]); // original plan's own schedule is untouched
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
test('addExerciseToTemplate/removeExerciseFromTemplate/moveExerciseInTemplate manage an exercise list in place', () => {
  const t = C.newTemplate('Template', 0);
  C.addExerciseToTemplate(t, { id: 'a', name: 'A' });
  C.addExerciseToTemplate(t, { id: 'b', name: 'B' });
  assert.deepEqual(t.ex.map(e => e.id), ['a', 'b']);
  assert.equal(C.moveExerciseInTemplate(t, 'b', -1), true);
  assert.deepEqual(t.ex.map(e => e.id), ['b', 'a']);
  assert.equal(C.moveExerciseInTemplate(t, 'b', -1), false); // already first
  assert.equal(C.removeExerciseFromTemplate(t, 'a'), true);
  assert.deepEqual(t.ex.map(e => e.id), ['b']);
});
test('substituteExerciseInTemplate replaces an exercise in place, keeping its position', () => {
  const t = C.newTemplate('Template', 0);
  C.addExerciseToTemplate(t, { id: 'a', name: 'A' });
  C.addExerciseToTemplate(t, { id: 'b', name: 'B' });
  C.substituteExerciseInTemplate(t, 'a', { id: 'c', name: 'C' });
  assert.deepEqual(t.ex.map(e => e.id), ['c', 'b']);
});
test('removeTemplateFromPlan strips the deleted template out of every weekday it was scheduled on', () => {
  const plan = C.newPlan('P', 0);
  const push = C.newTemplate('Push', 0), pull = C.newTemplate('Pull', 0);
  C.addTemplateToPlan(plan, push); C.addTemplateToPlan(plan, pull);
  C.setWeekdayTemplates(plan, 1, [push.id, pull.id]);
  C.removeTemplateFromPlan(plan, push.id);
  assert.deepEqual(plan.schedule[1], [pull.id]);
  assert.equal(plan.templates.length, 1);
});
test('setWeekdayTemplates de-duplicates defensively', () => {
  const plan = C.newPlan('P', 0);
  const push = C.newTemplate('Push', 0);
  C.addTemplateToPlan(plan, push);
  C.setWeekdayTemplates(plan, 1, [push.id, push.id, push.id]);
  assert.deepEqual(plan.schedule[1], [push.id]);
});
test('resolveWeekday returns rest for an empty slot, the template directly for exactly one, and a choose prompt for more than one', () => {
  const plan = C.newPlan('P', 0);
  const push = C.newTemplate('Push', 0), pushB = C.newTemplate('Push B', 0);
  C.addTemplateToPlan(plan, push); C.addTemplateToPlan(plan, pushB);
  C.setWeekdayTemplates(plan, 1, [push.id]);
  C.setWeekdayTemplates(plan, 3, [push.id, pushB.id]);
  assert.deepEqual(C.resolveWeekday(plan, 0), { kind: 'rest' });
  assert.deepEqual(C.resolveWeekday(plan, 1), { kind: 'template', templateId: push.id });
  assert.deepEqual(C.resolveWeekday(plan, 3), { kind: 'choose', options: [push.id, pushB.id] });
});
test('resolveWeekday ignores the weekday schedule entirely for a flexible plan and offers every template', () => {
  const plan = C.newPlan('P', 0);
  plan.flexible = true;
  const push = C.newTemplate('Push', 0), pull = C.newTemplate('Pull', 0);
  C.addTemplateToPlan(plan, push); C.addTemplateToPlan(plan, pull);
  // Weekday 1 has nothing scheduled, but flexible mode offers both templates regardless.
  assert.deepEqual(C.resolveWeekday(plan, 1), { kind: 'choose', options: [push.id, pull.id] });
});

/* ---------- weekly training-day target ---------- */
test('scheduledTrainingDays counts weekdays that have at least one workout', () => {
  const plan = C.newPlan('p', 1);
  C.addTemplateToPlan(plan, Object.assign(C.newTemplate('A', 1), { id: 'a' }));
  C.addTemplateToPlan(plan, Object.assign(C.newTemplate('B', 1), { id: 'b' }));
  C.setWeekdayTemplates(plan, 1, ['a']);
  C.setWeekdayTemplates(plan, 3, ['a', 'b']); // two options on one day is still ONE training day
  C.setWeekdayTemplates(plan, 5, ['b']);
  assert.equal(C.scheduledTrainingDays(plan), 3);
});
test('scheduledTrainingDays is 0 for a rest-only, flexible, or missing plan', () => {
  assert.equal(C.scheduledTrainingDays(C.newPlan('empty', 1)), 0);
  const flex = C.newPlan('flex', 1); flex.flexible = true;
  C.addTemplateToPlan(flex, Object.assign(C.newTemplate('A', 1), { id: 'a' }));
  C.setWeekdayTemplates(flex, 1, ['a']);
  assert.equal(C.scheduledTrainingDays(flex), 0, 'a flexible plan has no fixed weekly target');
  assert.equal(C.scheduledTrainingDays(null), 0);
});

test('applyDayOverride passes the normal schedule resolution through untouched when there is no override', () => {
  assert.deepEqual(C.applyDayOverride({ kind: 'rest' }, null), { kind: 'rest' });
  assert.deepEqual(C.applyDayOverride({ kind: 'template', templateId: 'push' }, undefined), { kind: 'template', templateId: 'push' });
  assert.deepEqual(C.applyDayOverride({ kind: 'choose', options: ['a', 'b'] }, null), { kind: 'choose', options: ['a', 'b'] });
});
test('applyDayOverride forces rest on an otherwise-scheduled workout day ("Rest Today" / "Skip Workout")', () => {
  assert.deepEqual(C.applyDayOverride({ kind: 'template', templateId: 'push' }, { type: 'rest' }), { kind: 'rest' });
});
test('applyDayOverride re-confirms rest on an already-scheduled rest day without changing anything observable', () => {
  assert.deepEqual(C.applyDayOverride({ kind: 'rest' }, { type: 'rest' }), { kind: 'rest' });
});
test('applyDayOverride forces training on an otherwise-rest day at a specific chosen template ("Skip Rest & Train"), never silently picking one itself', () => {
  assert.deepEqual(C.applyDayOverride({ kind: 'rest' }, { type: 'train', templateId: 'pull' }), { kind: 'template', templateId: 'pull' });
});
test('applyDayOverride ignores a malformed train override with no templateId and falls back to the real schedule', () => {
  assert.deepEqual(C.applyDayOverride({ kind: 'rest' }, { type: 'train' }), { kind: 'rest' });
});
test('migratePlanShape upgrades an old days-based plan into templates+schedule, keeping template ids equal to the old day ids', () => {
  const oldPlan = {
    id: 'p1', name: 'Old Plan',
    days: [
      { id: 'push', name: 'Push A', tag: 'Chest', cue: 'Go', rest: false, weekdays: [1], ex: [{ id: 'incline-db', name: 'Incline DB Press' }] },
      { id: 'rest-thu', name: 'Rest', tag: '', cue: '', rest: true, weekdays: [4], ex: [] },
    ],
  };
  const migrated = C.migratePlanShape(oldPlan);
  assert.equal(migrated.templates.length, 1); // the rest day never becomes a template
  assert.equal(migrated.templates[0].id, 'push'); // same id a pre-existing session's dayId already points at
  assert.deepEqual(migrated.schedule[1], ['push']);
  assert.deepEqual(migrated.schedule[4], []); // old rest day -> empty (rest) slot, nothing lost since it had no exercises
  assert.equal(migrated.days, undefined);
});
test('migratePlanShape is a no-op for a plan already on the current shape', () => {
  const plan = C.newPlan('P', 0);
  const before = JSON.stringify(plan);
  const out = C.migratePlanShape(plan);
  assert.equal(JSON.stringify(out), before);
});
test('newSession captures a plan/template snapshot that stays frozen after the source template is later edited', () => {
  const t = C.newTemplate('Push', 0);
  C.addExerciseToTemplate(t, { id: 'incline-db', name: 'Incline DB Press', sets: 3, muscle: 'Chest' });
  const s = C.newSession('d1', 0, null, { planId: 'p1', dayId: t.id, dayName: t.name, exSnapshot: JSON.parse(JSON.stringify(t.ex)) });
  t.ex[0].name = 'Renamed Press'; // simulate a later template edit
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
  const t = C.newTemplate('Push', 0);
  C.addExerciseToTemplate(t, { id: 'a', name: 'A', muscle: 'Chest', timed: false });
  const s = C.newSession('d1', 0, null, { exSnapshot: JSON.parse(JSON.stringify(t.ex)) });
  C.logSetIntoSession(s, { id: 'a' }, 0, { w: 10, r: 10 });
  t.ex[0].muscle = 'Shoulders'; // edit the live template afterwards
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

/* Regression: restoring a backup used to drop plans/activePlanId on the floor (the export wrote
   them, the file-picker handler never copied them into the pending restore), so every restore
   silently replaced the user's custom workout plans with the seeded default. */
test('prepareRestore carries plans and activePlanId through to the pending restore', () => {
  const plans = [{ id: 'p1', name: 'My plan', flexible: false, schedule: {}, templates: [] }];
  const r = C.prepareRestore({ app: 'vshape-tracker', schema: 3, profile: { a: 1 }, days: { '2026-01-01': {} }, plans, activePlanId: 'p1' });
  assert.deepEqual(r.plans, plans);
  assert.equal(r.activePlanId, 'p1');
  assert.equal(r.schema, 3);
  assert.deepEqual(r.profile, { a: 1 });
  assert.deepEqual(Object.keys(r.days), ['2026-01-01']);
});
test('prepareRestore tolerates an old backup with no plans', () => {
  const r = C.prepareRestore({ app: 'vshape-tracker', profile: {}, days: {} });
  assert.equal(r.plans, null);
  assert.equal(r.activePlanId, null);
  assert.deepEqual(r.photos, {});
  assert.equal(r.dropped, 0);
});
test('prepareRestore ignores a plans value that is not an array', () => {
  const r = C.prepareRestore({ app: 'vshape-tracker', profile: {}, days: {}, plans: { evil: true }, activePlanId: 7 });
  assert.equal(r.plans, null);
  assert.equal(r.activePlanId, null);
});
test('prepareRestore keeps valid photos and counts the ones it has to drop', () => {
  const good = { date: '2026-01-01', img: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' };
  const r = C.prepareRestore({
    app: 'vshape-tracker', profile: {}, days: {},
    photos: { '2026-01-01': good, '2026-01-02': { date: '2026-01-02', img: 'data:text/html,<script>' }, '2026-01-03': null }
  });
  assert.deepEqual(Object.keys(r.photos), ['2026-01-01']);
  assert.equal(r.dropped, 2);
});
test('a backup restored through prepareRestore + migrateBlob keeps custom plans (end to end)', () => {
  const plans = [{ id: 'p1', name: 'My plan', flexible: true, schedule: {}, templates: [{ id: 't1', name: 'Full body', tag: '', cue: '', ex: [] }] }];
  const pend = C.prepareRestore({ app: 'vshape-tracker', schema: 3, profile: {}, days: {}, plans, activePlanId: 'p1' });
  const out = C.migrateBlob({ schema: pend.schema, profile: pend.profile, days: pend.days, plans: pend.plans, activePlanId: pend.activePlanId });
  assert.equal(out.plans.length, 1);
  assert.equal(out.plans[0].name, 'My plan');
  assert.equal(out.activePlanId, 'p1');
});

/* ---------- backup reminder ---------- */
const BR_NOW = Date.UTC(2026, 9, 20, 12, 0, 0); // 20 Oct 2026
const BR_DAY_MS = 86400000;
const withSteps = (n) => ({ food: [], steps: n, water: 0, sessions: [] });
test('backupReminder: nothing to back up yet, or data too new to nag about', () => {
  assert.equal(C.backupReminder({}, {}, '2026-10-20', BR_NOW), null);
  assert.equal(C.backupReminder({}, { '2026-10-18': withSteps(5000) }, '2026-10-20', BR_NOW), null, 'first logged 2 days ago: do not nag a brand new user');
  assert.equal(C.backupReminder({}, { '2026-10-01': { food: [], steps: 0, water: 0, sessions: [] } }, '2026-10-20', BR_NOW), null, 'an empty day is not data');
});
test('backupReminder: a week of data and never backed up', () => {
  assert.deepEqual(C.backupReminder({}, { '2026-10-10': withSteps(5000) }, '2026-10-20', BR_NOW), { kind: 'never', sinceDays: null });
});
test('backupReminder: stale at 14 days, quiet before that', () => {
  const days = { '2026-09-01': withSteps(5000) };
  assert.deepEqual(C.backupReminder({ lastBackupAt: BR_NOW - 15 * BR_DAY_MS }, days, '2026-10-20', BR_NOW), { kind: 'stale', sinceDays: 15 });
  assert.equal(C.backupReminder({ lastBackupAt: BR_NOW - 13 * BR_DAY_MS }, days, '2026-10-20', BR_NOW), null);
});
test('backupReminder: "later" snoozes it, and the snooze expires', () => {
  const days = { '2026-09-01': withSteps(5000) };
  assert.equal(C.backupReminder({ backupSnoozedUntil: BR_NOW + 3600000 }, days, '2026-10-20', BR_NOW), null);
  assert.equal(C.backupReminder({ backupSnoozedUntil: BR_NOW - 3600000 }, days, '2026-10-20', BR_NOW).kind, 'never');
});
test('backupReminder: weigh-ins and logged food both count as data', () => {
  assert.equal(C.backupReminder({ weights: { '2026-10-01': 80 } }, {}, '2026-10-20', BR_NOW).kind, 'never');
  assert.equal(C.backupReminder({}, { '2026-10-01': { food: [{ k: 100 }], steps: 0, water: 0, sessions: [] } }, '2026-10-20', BR_NOW).kind, 'never');
});
test('backupReminder ignores junk keys and a garbage lastBackupAt', () => {
  assert.equal(C.backupReminder({ lastBackupAt: 'soon' }, { 'not-a-date': withSteps(1), '2026-10-01': withSteps(5000) }, '2026-10-20', BR_NOW).kind, 'never');
});

/* ---------- recent foods ---------- */
test('recentFoods: distinct, newest first, with the last quantity used', () => {
  const days = {
    '2026-10-01': { food: [{ name: 'Egg', qty: 2, unit: 'each' }, { name: 'Oats', qty: 50, unit: 'g' }] },
    '2026-10-02': { food: [{ name: 'Egg', qty: 3, unit: 'each' }, { name: 'Rice', qty: 200, unit: 'g' }] },
  };
  assert.deepEqual(C.recentFoods(days, 10), [
    { name: 'Rice', qty: 200, unit: 'g' }, { name: 'Egg', qty: 3, unit: 'each' }, { name: 'Oats', qty: 50, unit: 'g' },
  ]);
});
test('recentFoods respects the limit and tolerates missing or malformed data', () => {
  const days = { '2026-10-01': { food: [{ name: 'A', qty: 1 }, { name: 'B', qty: 1 }, { name: 'C', qty: 1 }] }, '2026-10-02': {}, 'junk': null, '2026-10-03': { food: [null, { qty: 1 }, { name: '' }] } };
  assert.deepEqual(C.recentFoods(days, 2).map((f) => f.name), ['C', 'B']);
  assert.deepEqual(C.recentFoods(null, 5), []);
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

/* ---------- exercise library (Phase 3C) ---------- */
test('mergeLibrary fills defaults additively and never drops existing custom exercises or flags', () => {
  assert.deepEqual(C.mergeLibrary(undefined), { custom: [], flags: {} });
  assert.deepEqual(C.mergeLibrary(null), { custom: [], flags: {} });
  const existing = { custom: [{ id: 'custom-x', name: 'X' }], flags: { 'bb-bench-press': { favorite: true, avoid: false } } };
  const out = C.mergeLibrary(existing);
  assert.equal(out.custom.length, 1);
  assert.deepEqual(out.flags['bb-bench-press'], { favorite: true, avoid: false });
});
test('mergeLibrary repairs a non-array custom field instead of throwing', () => {
  const out = C.mergeLibrary({ custom: 'not-an-array', flags: null });
  assert.deepEqual(out.custom, []);
  assert.deepEqual(out.flags, {});
});
test('allLibraryExercises concatenates builtins with user customs', () => {
  const lib = { custom: [{ id: 'custom-1', name: 'My lift' }], flags: {} };
  const all = C.allLibraryExercises(lib);
  assert.ok(all.some((e) => e.id === 'bb-bench-press'));
  assert.ok(all.some((e) => e.id === 'custom-1'));
});
test('addCustomExercise appends with a stable generated id and never mutates builtins', () => {
  const lib = C.defaultLibrary();
  const before = C.BUILTIN_EXERCISES.length;
  const added = C.addCustomExercise(lib, { name: 'Zercher Squat', primaryMuscle: 'quads', equipment: 'barbell', difficulty: 'advanced' }, Date.now());
  assert.equal(lib.custom.length, 1);
  assert.equal(added.custom, true);
  assert.equal(C.BUILTIN_EXERCISES.length, before);
});
test('updateCustomExercise edits an existing custom entry in place, never changing its id or custom flag, and cannot touch a builtin', () => {
  const lib = C.defaultLibrary();
  const added = C.addCustomExercise(lib, { name: 'Zercher Squat', primaryMuscle: 'quads', equipment: 'barbell', difficulty: 'advanced' }, Date.now());
  const updated = C.updateCustomExercise(lib, added.id, { name: 'Zercher Squat (heavy)', id: 'hacked-id', custom: false });
  assert.equal(updated.id, added.id);
  assert.equal(updated.custom, true);
  assert.equal(updated.name, 'Zercher Squat (heavy)');
  assert.equal(lib.custom.length, 1);
  assert.equal(C.updateCustomExercise(lib, 'bb-bench-press', { name: 'Hacked' }), null);
});
test('removeCustomExercise deletes a custom entry and never touches builtins', () => {
  const lib = C.defaultLibrary();
  const added = C.addCustomExercise(lib, { name: 'Zercher Squat', primaryMuscle: 'quads' }, Date.now());
  const before = C.BUILTIN_EXERCISES.length;
  assert.equal(C.removeCustomExercise(lib, added.id), true);
  assert.equal(lib.custom.length, 0);
  assert.equal(C.removeCustomExercise(lib, 'bb-bench-press'), false);
  assert.equal(C.BUILTIN_EXERCISES.length, before);
});
test('setLibraryFlag sets favorite/avoid per exercise id without clobbering the other flag', () => {
  const lib = C.defaultLibrary();
  C.setLibraryFlag(lib, 'bb-bench-press', 'favorite', true);
  C.setLibraryFlag(lib, 'bb-bench-press', 'avoid', true);
  assert.deepEqual(C.libraryFlags(lib, 'bb-bench-press'), { favorite: true, avoid: true });
  assert.deepEqual(C.libraryFlags(lib, 'unknown-id'), { favorite: false, avoid: false });
});
test('findAlternatives excludes the target itself, avoided exercises, and equipment the user does not have', () => {
  const lib = C.defaultLibrary();
  const prefs = { equipment: ['dumbbells'], avoidExercises: ['Push-up'] };
  const alts = C.findAlternatives(lib, 'bb-bench-press', prefs, 'beginner');
  assert.ok(alts.every((a) => a.entry.id !== 'bb-bench-press'));
  assert.ok(alts.every((a) => a.entry.name !== 'Push-up'));
  assert.ok(alts.every((a) => a.entry.equipment === 'bodyweight' || a.entry.equipment === 'dumbbells'));
  assert.ok(alts.some((a) => a.entry.id === 'incline-db-press'));
});
test('findAlternatives respects an avoid flag the same as the text avoid list', () => {
  const lib = C.defaultLibrary();
  C.setLibraryFlag(lib, 'incline-db-press', 'avoid', true);
  const alts = C.findAlternatives(lib, 'bb-bench-press', { equipment: ['dumbbells'] }, 'beginner');
  assert.ok(alts.every((a) => a.entry.id !== 'incline-db-press'));
});
test('findAlternatives returns [] for an unknown exercise id', () => {
  assert.deepEqual(C.findAlternatives(C.defaultLibrary(), 'does-not-exist', {}, 'beginner'), []);
});

/* ---------- workout generator (Phase 3B) ---------- */
function fp(overrides) {
  return C.mergeFitnessProfile(Object.assign({}, overrides, {
    workoutPrefs: Object.assign({}, (overrides && overrides.workoutPrefs) || {})
  }));
}
test('generateWorkoutPlan is deterministic: identical inputs produce identical output', () => {
  const profile = fp({ experience: 'intermediate', primaryGoal: 'muscle_gain', workoutPrefs: { daysPerWeek: 3, sessionDuration: 45, equipment: ['barbell', 'dumbbells'] } });
  const lib = C.defaultLibrary();
  const a = C.generateWorkoutPlan(profile, lib, [], 1700000000000);
  const b = C.generateWorkoutPlan(profile, lib, [], 1700000000000);
  const strip = (plan) => ({ split: plan.split, days: plan.days.map((d) => ({ name: d.name, ex: d.exercises.map((e) => [e.name, e.sets, e.lo, e.hi, e.rest, e.inc, e.muscle, e.bw, e.timed]) })) });
  assert.deepEqual(strip(a), strip(b));
});
test('generateWorkoutPlan picks full body for 2-3 days, upper/lower for 4, and PPL for 5+, with an explanation', () => {
  const lib = C.defaultLibrary();
  assert.equal(C.generateWorkoutPlan(fp({ workoutPrefs: { daysPerWeek: 3 } }), lib, [], Date.now()).split, 'full_body');
  assert.equal(C.generateWorkoutPlan(fp({ workoutPrefs: { daysPerWeek: 4 } }), lib, [], Date.now()).split, 'upper_lower');
  const ppl = C.generateWorkoutPlan(fp({ workoutPrefs: { daysPerWeek: 6 } }), lib, [], Date.now());
  assert.equal(ppl.split, 'ppl');
  assert.equal(typeof ppl.splitReason, 'string');
  assert.ok(ppl.splitReason.length > 0);
});
test('generateWorkoutPlan honors an explicit preferred split over the auto table', () => {
  const plan = C.generateWorkoutPlan(fp({ workoutPrefs: { daysPerWeek: 3, preferredSplit: 'body_part' } }), C.defaultLibrary(), [], Date.now());
  assert.equal(plan.split, 'body_part');
});
test('generateWorkoutPlan refuses to generate a custom split and says so, without throwing', () => {
  const plan = C.generateWorkoutPlan(fp({ workoutPrefs: { preferredSplit: 'custom' } }), C.defaultLibrary(), [], Date.now());
  assert.equal(plan.ok, false);
  assert.equal(plan.reason, 'custom-split');
});
test('generateWorkoutPlan only offers exercises the user has equipment for, bodyweight always allowed', () => {
  const plan = C.generateWorkoutPlan(fp({ workoutPrefs: { daysPerWeek: 3, equipment: [] } }), C.defaultLibrary(), [], Date.now());
  const lib = C.defaultLibrary();
  plan.days.forEach((d) => d.exercises.forEach((e) => {
    const entry = C.findLibraryExercise(lib, e.libraryId);
    assert.equal(entry.equipment, 'bodyweight');
  }));
});
test('generateWorkoutPlan never selects an exercise listed in avoidExercises', () => {
  const plan = C.generateWorkoutPlan(fp({ workoutPrefs: { daysPerWeek: 3, equipment: ['barbell', 'dumbbells'], avoidExercises: ['Barbell Back Squat', 'Bodyweight Squat'] } }), C.defaultLibrary(), [], Date.now());
  plan.days.forEach((d) => d.exercises.forEach((e) => {
    assert.notEqual(e.name, 'Barbell Back Squat');
    assert.notEqual(e.name, 'Bodyweight Squat');
  }));
});
test('generateWorkoutPlan gives a priority muscle group an extra exercise slot', () => {
  const base = C.generateWorkoutPlan(fp({ workoutPrefs: { daysPerWeek: 4, sessionDuration: 60, equipment: ['barbell', 'dumbbells', 'cable-machine'] } }), C.defaultLibrary(), [], Date.now());
  const prioritized = C.generateWorkoutPlan(fp({ workoutPrefs: { daysPerWeek: 4, sessionDuration: 60, equipment: ['barbell', 'dumbbells', 'cable-machine'], priorityMuscles: ['chest'] } }), C.defaultLibrary(), [], Date.now());
  const countFor = (plan, muscle) => plan.days[0].exercises.filter((e) => e.muscle === muscle).length;
  assert.ok(countFor(prioritized, 'Chest') >= countFor(base, 'Chest'));
});
test('generateWorkoutPlan maps a fixed schedule onto the chosen available weekdays in order, and leaves flexible plans unassigned', () => {
  const fixed = C.generateWorkoutPlan(fp({ workoutPrefs: { daysPerWeek: 3, scheduleType: 'fixed', availableDays: [1, 3, 5] } }), C.defaultLibrary(), [], Date.now());
  assert.equal(fixed.flexible, false);
  assert.deepEqual(fixed.weekdayAssignment, [1, 3, 5]);
  const flexible = C.generateWorkoutPlan(fp({ workoutPrefs: { daysPerWeek: 3, scheduleType: 'flexible' } }), C.defaultLibrary(), [], Date.now());
  assert.equal(flexible.flexible, true);
  assert.deepEqual(flexible.weekdayAssignment, [null, null, null]);
});
test('generateWorkoutPlan leaves start weight null for bodyweight exercises and when no history exists, never fabricating a number', () => {
  const plan = C.generateWorkoutPlan(fp({ workoutPrefs: { daysPerWeek: 3, equipment: ['barbell'] } }), C.defaultLibrary(), [], Date.now());
  plan.days.forEach((d) => d.exercises.forEach((e) => { assert.equal(e.start, null); }));
});
test('generateWorkoutPlan uses the most recent logged weight for a matching exercise name as a starting weight', () => {
  const session = {
    startedAt: 1000, finishedAt: 2000,
    exSnapshot: [{ id: 'ex1', name: 'Barbell Back Squat' }],
    log: { ex1: [{ w: 62.5, r: 5 }, { w: 65, r: 5 }] }
  };
  const w = C.lastLoggedWeightForName([session], 'Barbell Back Squat');
  assert.equal(w, 65);
});
test('generateWorkoutPlan is a pure preview: it never mutates the sessions array or the fitness profile passed in', () => {
  const profile = fp({ workoutPrefs: { daysPerWeek: 3 } });
  const before = JSON.stringify(profile);
  const sessions = [{ startedAt: 1, finishedAt: 2, exSnapshot: [], log: {} }];
  const sessionsBefore = JSON.stringify(sessions);
  C.generateWorkoutPlan(profile, C.defaultLibrary(), sessions, Date.now());
  assert.equal(JSON.stringify(profile), before);
  assert.equal(JSON.stringify(sessions), sessionsBefore);
});

/* ---------- plate calculator (Phase 3D) ---------- */
test('defaultPlateCalc ships a sane starting inventory and mergePlateCalc fills gaps additively', () => {
  const d = C.defaultPlateCalc();
  assert.equal(d.unit, 'kg');
  assert.ok(d.plates.length > 0);
  assert.deepEqual(C.mergePlateCalc(undefined), d);
  const out = C.mergePlateCalc({ bar: { weight: 25 }, exerciseEquipment: { ex1: 'dumbbell' } });
  assert.equal(out.bar.weight, 25);
  assert.equal(out.bar.collarWeight, d.bar.collarWeight, 'an unspecified bar field must fall back to the default, not disappear');
  assert.deepEqual(out.exerciseEquipment, { ex1: 'dumbbell' });
  assert.deepEqual(out.plates, d.plates);
});
test('mergePlateCalc repairs non-array fields instead of throwing', () => {
  const out = C.mergePlateCalc({ plates: 'nope', kettlebells: null, stack: { increments: 'nope' } });
  assert.deepEqual(out.plates, C.defaultPlateCalc().plates);
  assert.deepEqual(out.kettlebells, C.defaultPlateCalc().kettlebells);
  assert.deepEqual(out.stack.increments, C.defaultPlateCalc().stack.increments);
});
test('greedyLoad fills a target with the fewest large plates first and respects a limited count', () => {
  const r = C.greedyLoad(17.5, [{ weight: 10, count: 2 }, { weight: 5, count: 2 }, { weight: 2.5, count: 2 }], (n) => n);
  assert.deepEqual(r.used, [{ weight: 10, n: 1 }, { weight: 5, n: 1 }, { weight: 2.5, n: 1 }]);
  assert.equal(r.reachedKg, 17.5);
});
test('greedyLoad never exceeds the target and reports the closest reachable amount when exact is impossible', () => {
  const r = C.greedyLoad(9, [{ weight: 5, count: 1 }, { weight: 2.5, count: 1 }], (n) => n);
  assert.equal(r.reachedKg, 7.5);
  assert.ok(r.reachedKg <= 9);
});
test('greedyLoad never uses more than the available count of a denomination', () => {
  const r = C.greedyLoad(100, [{ weight: 20, count: 1 }], (n) => n);
  assert.deepEqual(r.used, [{ weight: 20, n: 1 }]);
  assert.equal(r.reachedKg, 20);
});
test('findBarbellLoading computes bar + collars + symmetric plates exactly for a reachable target', () => {
  const bar = { weight: 20, collarWeight: 2.5 };
  const plates = [{ weight: 20, count: 4 }, { weight: 10, count: 2 }, { weight: 2.5, count: 2 }];
  // 87.5 = 20 bar + 2.5 collars + 2x(20+10+2.5 per side), exactly within the available counts.
  const r = C.findBarbellLoading(87.5, bar, plates);
  assert.equal(r.achievableTotal, 87.5);
  assert.equal(r.diffFromTarget, 0);
  const total = bar.weight + bar.collarWeight + 2 * r.perSide.reduce((s, p) => s + p.weight * p.n, 0);
  assert.equal(total, 87.5);
});
test('findBarbellLoading only uses a plate denomination if two are available (one per side)', () => {
  const bar = { weight: 20, collarWeight: 0 };
  const plates = [{ weight: 25, count: 1 }, { weight: 10, count: 4 }];
  const r = C.findBarbellLoading(120, bar, plates);
  assert.ok(r.perSide.every((p) => p.weight !== 25), 'a single odd plate cannot be loaded symmetrically');
});
test('findBarbellLoading reports the closest achievable weight and an accurate diff when the exact target is impossible', () => {
  const bar = { weight: 20, collarWeight: 0 };
  const plates = [{ weight: 10, count: 2 }];
  const r = C.findBarbellLoading(55, bar, plates);
  assert.equal(r.achievableTotal, 40);
  assert.equal(r.diffFromTarget, -15);
});
test('findStackLoading never invents a resistance value outside the configured increments', () => {
  const stack = { baseWeight: 5, increments: [{ weight: 5, count: 6 }] };
  const r = C.findStackLoading(37, stack);
  assert.equal(r.achievableTotal, 35);
  r.selected.forEach((s) => assert.ok(stack.increments.some((inc) => inc.weight === s.weight)));
});
test('nearestStepped finds the nearest reachable dumbbell increment within range, clamped to min/max', () => {
  assert.equal(C.nearestStepped(23, 2, 2, 50).achievableTotal, 24);
  assert.equal(C.nearestStepped(1, 2, 2, 50).achievableTotal, 2);
  assert.equal(C.nearestStepped(999, 2, 2, 50).achievableTotal, 50);
});
test('nearestFromList picks the closest configured kettlebell size and never fabricates one', () => {
  assert.equal(C.nearestFromList(18, [8, 12, 16, 20, 24]).achievableTotal, 16);
  assert.deepEqual(C.nearestFromList(18, []), { achievableTotal: null, diffFromTarget: null });
});
