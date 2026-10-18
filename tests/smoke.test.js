'use strict';
/* Smoke tests: run the real core.js + app.js source inside a minimal fake
   browser (see env.js) and check externally-observable effects. This is not
   a substitute for testing in an actual browser/WebView, but it catches
   startup crashes and verifies the migration path end to end. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createSandbox } = require('./env.js');

const CORE_SRC = fs.readFileSync(path.join(__dirname, '..', 'core.js'), 'utf8');
const APP_SRC = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const KNOWN_IDS = ['app', 'nav', 'toast', 'timer', 'sheet-root', 'csvIn', 'photoIn', 'backupIn', 'stepsIn'];

function boot(sandbox) {
  vm.runInContext(CORE_SRC, sandbox, { filename: 'core.js' });
  vm.runInContext(APP_SRC, sandbox, { filename: 'app.js' });
}
// Drives app.js's single delegated document click listener the same way a
// real tap on a [data-act] element would, without needing a real DOM event
// system - env.js already funnels document.addEventListener('click', fn)
// registrations into sandbox.__listeners.click.
function fireClick(sandbox, act, dataset) {
  const target = { dataset: Object.assign({ act }, dataset || {}), closest(sel) { return sel === '[data-act]' ? target : null; } };
  (sandbox.__listeners.click || []).forEach((fn) => fn({ target }));
}
function sheetHTML(sandbox) { return sandbox.document.querySelector('#sheet-root').innerHTML; }
function setVal(sandbox, id, v) { sandbox.document.querySelector('#' + id).value = v; }

test('smoke: fresh install boots, renders, and does not inject a fake 70kg weigh-in', () => {
  const sandbox = createSandbox(KNOWN_IDS);
  assert.doesNotThrow(() => boot(sandbox));
  const html = sandbox.document.querySelector('#app').innerHTML;
  assert.ok(html.length > 200, 'expected the Today view to render real content');
  assert.ok(!html.includes('70 kg logged'), 'a fresh install must not pre-fill a 70 kg weigh-in');
  assert.ok(html.includes('V-SHAPE'), 'expected the app header to render');
});

test('smoke: a legacy (schema-less) backup is migrated to schema 3 sessions on boot, with a safety copy kept', () => {
  const sandbox = createSandbox(KNOWN_IDS);
  const legacy = {
    profile: { targets: { kcal: 2350, protein: 160, steps: 20000, water: 3000 }, weights: { '2026-01-01': 71 }, customFoods: [] },
    days: {
      '2026-01-01': {
        date: '2026-01-01', food: [], steps: 8000,
        w: { day: 'push', log: { 'incline-db': [{ w: 20, r: 8 }, null, { w: 20, r: 7 }] } }
      }
    }
  };
  sandbox.localStorage.setItem('vshape-tracker-v1', JSON.stringify({ profile: legacy.profile, days: legacy.days }));

  assert.doesNotThrow(() => boot(sandbox));

  const saved = JSON.parse(sandbox.localStorage.getItem('vshape-tracker-v1'));
  assert.equal(saved.schema, 3);
  assert.ok(saved.plans && saved.plans.length >= 1, 'expected a default plan to be seeded for data that never had one');
  const day = saved.days['2026-01-01'];
  assert.equal(day.sessions.length, 1);
  assert.equal(day.sessions[0].day, 'push');
  assert.deepEqual(day.sessions[0].log['incline-db'][0], { w: 20, r: 8 });
  assert.equal(day.sessions[0].log['incline-db'][1], null);
  assert.ok(day.sessions[0].exSnapshot && day.sessions[0].exSnapshot.length, 'expected a backfilled exercise snapshot for the pre-existing session');
  // The seeded default plan's template ids MUST equal the old literal program keys ('push'/'pull'/...) a
  // pre-plans session already has in its own `day` field - otherwise openSessionFor/lastSessionFor
  // (which match by exact id equality) can never find this session again, and the Train tab
  // would silently show a previously-logged day as if nothing had been logged, even though the data
  // itself is intact and still counted correctly by history()/PR/volume (which don't filter by this id).
  const pushTemplate = saved.plans[0].templates.find((t) => t.name === 'Push A');
  assert.equal(pushTemplate.id, 'push', 'the seeded "Push A" template must keep the literal id a migrated session already refers to');

  const backupKeys = [];
  for (let i = 0; i < sandbox.localStorage.length; i++) backupKeys.push(sandbox.localStorage.key(i));
  const safetyKey = backupKeys.find((k) => k.indexOf('pre-migration') >= 0);
  assert.ok(safetyKey, 'expected an untouched copy of the pre-migration data to be kept');
  const safetyRaw = JSON.parse(sandbox.localStorage.getItem(safetyKey));
  assert.equal(safetyRaw.days['2026-01-01'].w.log['incline-db'][0].w, 20);
});

test('smoke: a real-world schema-2 install (the one actually shipped) keeps a finished session visible on its original date after migration', () => {
  const sandbox = createSandbox(KNOWN_IDS);
  const seeded = {
    schema: 2,
    profile: { targets: { kcal: 2350, protein: 160, steps: 20000, water: 3000 }, weights: {}, customFoods: [] },
    days: {
      '2026-01-01': {
        date: '2026-01-01', food: [], steps: 0, stepsSource: null, water: 0,
        sessions: [{ id: 's1', day: 'push', label: null, startedAt: 1000, finishedAt: 5000, status: 'finished', pausedAt: null, pausedMs: 0, lastAppliedSeq: 0, log: { 'incline-db': [{ w: 20, r: 8 }] }, rest: null }],
        quarantine: { sets: [], food: [] },
      },
    },
  };
  sandbox.localStorage.setItem('vshape-tracker-v1', JSON.stringify(seeded));
  assert.doesNotThrow(() => boot(sandbox));

  // Navigate to that exact date on the Train tab and tap the actual rendered "Push A" pill,
  // the same way a real user would - its data-k comes from the live (now-seeded) plan day's
  // id, not a hardcoded string, so this only passes if that id still equals the migrated
  // session's own `day` field. Once a session is finished, the exercise rows intentionally go
  // blank again (ready for the next workout) - the signal that the migrated session is still
  // found by its day key is the "Finished ... elapsed" lifecycle summary, which only renders
  // when lastSessionFor(date, key) actually finds it.
  fireClick(sandbox, 'gotod', { d: '2026-01-01' });
  fireClick(sandbox, 'tab', { tab: 'train' });
  let html = sandbox.document.querySelector('#app').innerHTML;
  const pushPillId = html.match(/data-act="wd" data-k="([^"]+)"[^>]*>Push A</)[1];
  fireClick(sandbox, 'wd', { k: pushPillId });
  html = sandbox.document.querySelector('#app').innerHTML;
  assert.ok(html.includes('Finished'), 'expected the migrated finished session to still be found by its day key and shown as "Finished ..."');
});

test('smoke: a storage failure while reconciling a native action leaves the queue unacknowledged for retry', async () => {
  const sandbox = createSandbox(KNOWN_IDS);
  const activeSession = { id: 'sess1', day: 'push', label: null, startedAt: 1000, finishedAt: null, status: 'active', pausedAt: null, pausedMs: 0, lastAppliedSeq: 0, log: {}, rest: null };
  const seeded = {
    schema: 2,
    profile: { targets: { kcal: 2350, protein: 160, steps: 20000, water: 3000 }, weights: {}, customFoods: [] },
    days: { '2026-01-01': { date: '2026-01-01', food: [], steps: 0, stepsSource: null, water: 0, sessions: [activeSession], quarantine: { sets: [], food: [] } } },
    active: { date: '2026-01-01', id: 'sess1' },
  };
  sandbox.localStorage.setItem('vshape-tracker-v1', JSON.stringify(seeded));

  let cleared = false;
  const plugin = {
    getPendingActions() { return Promise.resolve({ actions: [{ seq: 1, type: 'pause', sessionId: 'sess1', ts: 5000 }] }); },
    clearPendingActions() { cleared = true; return Promise.resolve(); },
    show() { return Promise.resolve({}); },
    hide() { return Promise.resolve({}); },
  };
  sandbox.Capacitor = { isNativePlatform: () => true, Plugins: { WorkoutNotification: plugin } };

  const realSetItem = sandbox.localStorage.setItem.bind(sandbox.localStorage);
  let writesShouldFail = false;
  sandbox.localStorage.setItem = function (k, v) {
    if (writesShouldFail) throw new Error('QuotaExceededError');
    return realSetItem(k, v);
  };

  assert.doesNotThrow(() => boot(sandbox));
  writesShouldFail = true; // simulate full storage only after boot's own (unrelated) writes settle

  await new Promise((resolve) => setTimeout(resolve, 900)); // let the real startup setTimeout(…,800) fire reconcileNativeActions()

  assert.equal(cleared, false, 'the native action queue must not be acknowledged when the resulting save failed - it must stay queued for retry');
});

function seedActiveSession(sandbox, overrides) {
  const activeSession = Object.assign({
    id: 'sess1', day: 'push', label: null, startedAt: 1000, finishedAt: null, status: 'active',
    pausedAt: null, pausedMs: 0, lastAppliedSeq: 0, log: {}, rest: null,
    exSnapshot: [{ id: 'incline-db', name: 'Incline DB Press', sets: 2, lo: 6, hi: 10, rest: 90, inc: 2, start: 18, muscle: 'Chest' }],
  }, overrides || {});
  const seeded = {
    schema: 3,
    profile: { targets: { kcal: 2350, protein: 160, steps: 20000, water: 3000 }, weights: {}, customFoods: [] },
    days: { '2026-01-01': { date: '2026-01-01', food: [], steps: 0, stepsSource: null, water: 0, sessions: [activeSession], quarantine: { sets: [], food: [] } } },
    active: { date: '2026-01-01', id: 'sess1' },
  };
  sandbox.localStorage.setItem('vshape-tracker-v1', JSON.stringify(seeded));
  return activeSession;
}
test('smoke: a native "Log Set" action is applied end-to-end (durable log + rest timer start + queue acknowledged), recording exactly what was sent even when it differs from the suggested load', async () => {
  const sandbox = createSandbox(KNOWN_IDS);
  seedActiveSession(sandbox);
  let cleared = false, shown = null;
  const plugin = {
    getPendingActions() { return Promise.resolve({ actions: [{ seq: 1, type: 'logset', sessionId: 'sess1', exId: 'incline-db', index: 0, w: 25, r: 7, ts: 5000 }] }); },
    clearPendingActions() { cleared = true; return Promise.resolve(); },
    show(p) { shown = p; return Promise.resolve({}); },
    hide() { return Promise.resolve({}); },
  };
  sandbox.Capacitor = { isNativePlatform: () => true, Plugins: { WorkoutNotification: plugin } };
  assert.doesNotThrow(() => boot(sandbox));
  await new Promise((resolve) => setTimeout(resolve, 900));

  assert.equal(cleared, true, 'a successfully-applied logset action must be acknowledged so it is not retried');
  const saved = JSON.parse(sandbox.localStorage.getItem('vshape-tracker-v1'));
  const session = saved.days['2026-01-01'].sessions[0];
  assert.deepEqual(session.log['incline-db'][0], { w: 25, r: 7 }, 'the exact weight/reps the notification sent must be recorded, not the suggested starting load (18kg)');
  assert.ok(session.rest, 'expected the rest timer to have started automatically once the set was logged');
  assert.ok(shown, 'expected the notification to be redrawn with the new state after the log was applied');
  assert.equal(shown.state, 'resting');
});
test('smoke: finishing via the notification (a durably-queued "finish" action, exactly as it would survive the app process dying before reconciling) preserves every previously-logged set and clears the rest timer, acknowledged only after the save succeeds', async () => {
  const sandbox = createSandbox(KNOWN_IDS);
  // Two sets already logged before the notification's Finish button was tapped - this is
  // what "process death before reconciliation" looks like from boot()'s point of view: the
  // queued action is already sitting in the native journal when the app (re)starts.
  seedActiveSession(sandbox, {
    log: { 'incline-db': [{ w: 22, r: 8 }, { w: 22, r: 7 }] },
    rest: { exId: 'incline-db', label: 'Incline DB Press', startedAt: 900, durationMs: 90000, deadline: 90900, paused: false, pausedRemainingMs: null, done: false },
  });
  let cleared = false;
  const shownPayloads = [];
  const plugin = {
    getPendingActions() { return Promise.resolve({ actions: [{ seq: 1, type: 'finish', sessionId: 'sess1', ts: 5000 }] }); },
    clearPendingActions() { cleared = true; return Promise.resolve(); },
    show(p) { shownPayloads.push(p); return Promise.resolve({}); },
    hide() { return Promise.resolve({}); },
  };
  sandbox.Capacitor = { isNativePlatform: () => true, Plugins: { WorkoutNotification: plugin } };
  assert.doesNotThrow(() => boot(sandbox));
  await new Promise((resolve) => setTimeout(resolve, 50)); // let boot's own initial render (session still "active" with rest, pre-reconciliation) settle first
  shownPayloads.length = 0;
  await new Promise((resolve) => setTimeout(resolve, 850)); // the startup reconciliation runs and applies the queued finish action

  assert.equal(cleared, true, 'a successfully-applied finish action must be acknowledged so it is not retried');
  const saved = JSON.parse(sandbox.localStorage.getItem('vshape-tracker-v1'));
  const session = saved.days['2026-01-01'].sessions[0];
  assert.equal(session.status, 'finished');
  assert.deepEqual(session.log['incline-db'], [{ w: 22, r: 8 }, { w: 22, r: 7 }], 'both sets logged before Finish was tapped must still be exactly there - finishing must never touch session.log');
  assert.equal(session.rest, null, 'finishing must clear any in-progress rest');
  // shouldShowNotification(session) is false once finished, so the push caused by reconciling
  // must hide the notification, not show a stale "resting" one.
  assert.ok(shownPayloads.length === 0, 'a finished session must never be shown as an active/resting notification');
});
test('smoke: finishing a workout and immediately re-viewing it in Train shows the exact same logged weights/reps as before finishing - at no point does the display (or the data) go blank', () => {
  const sandbox = createSandbox(KNOWN_IDS);
  boot(sandbox);
  fireClick(sandbox, 'gotod', { d: '2026-01-05' }); // Monday - the default plan's scheduled Push A day
  fireClick(sandbox, 'tab', { tab: 'train' });
  fireClick(sandbox, 'startworkout');
  const row = { dataset: { ex: 'incline-db', i: '0' }, closest(sel) { return sel === '.set' ? row : null; }, querySelector(sel) { return sel === '[data-f=w]' ? { value: '24' } : sel === '[data-f=r]' ? { value: '9' } : null; } };
  const logTarget = { dataset: { act: 'logset' }, closest(sel) { return sel === '[data-act]' ? logTarget : (sel === '.set' ? row : null); } };
  (sandbox.__listeners.click || []).forEach((fn) => fn({ target: logTarget }));

  let html = sandbox.document.querySelector('#app').innerHTML;
  assert.ok(html.includes('value="24"'), 'sanity check: the set was actually logged before finishing');

  fireClick(sandbox, 'finishworkout');
  fireClick(sandbox, 'finishworkout2');

  html = sandbox.document.querySelector('#app').innerHTML;
  assert.ok(html.includes('value="24"'), 'the exact same logged weight must still be visible immediately after finishing, not reset to the suggested starting load');
  assert.ok(html.includes('>1/3<') || html.includes('>1/'), 'the sets-done count must still reflect the 1 logged set, not 0');

  const saved = JSON.parse(sandbox.localStorage.getItem('vshape-tracker-v1'));
  const session = Object.values(saved.days).flatMap((d) => d.sessions).find((s) => s.status === 'finished');
  assert.deepEqual(session.log['incline-db'][0], { w: 24, r: 9 }, 'the saved history itself must be exactly what was logged');
});
test('smoke: the notification payload carries everything native needs to walk the rest of the workout offline (exSnapshot, committedLog, a full suggestion lookahead table)', async () => {
  const sandbox = createSandbox(KNOWN_IDS);
  seedActiveSession(sandbox, {
    exSnapshot: [
      { id: 'incline-db', name: 'Incline DB Press', sets: 1, lo: 6, hi: 10, rest: 90, inc: 2, start: 18, muscle: 'Chest' },
      { id: 'machine-chest', name: 'Machine Chest Press', sets: 1, lo: 8, hi: 12, rest: 120, inc: 5, start: 40, muscle: 'Chest' },
    ],
  });
  let shown = null;
  const plugin = {
    getPendingActions() { return Promise.resolve({ actions: [] }); },
    clearPendingActions() { return Promise.resolve(); },
    show(p) { shown = p; return Promise.resolve({}); },
    hide() { return Promise.resolve({}); },
  };
  sandbox.Capacitor = { isNativePlatform: () => true, Plugins: { WorkoutNotification: plugin } };
  assert.doesNotThrow(() => boot(sandbox));
  await new Promise((resolve) => setTimeout(resolve, 900));

  assert.ok(shown, 'expected a notification payload');
  assert.ok(Array.isArray(shown.exSnapshot) && shown.exSnapshot.length === 2, 'expected the full exercise snapshot, not just the current exercise');
  assert.ok(shown.committedLog && typeof shown.committedLog === 'object', 'expected the current session.log so native can tell what is already logged');
  assert.ok(Array.isArray(shown.suggestions) && shown.suggestions.length === 2, 'expected a suggestion entry for every exercise with pending sets, not only the current one');
  const machineChest = shown.suggestions.find((s) => s.exId === 'machine-chest');
  assert.ok(machineChest && Array.isArray(machineChest.reps), 'expected a full reps array per exercise so native can look up any pending set index without running progression logic itself');
});
test('smoke: a native "Log Set" action is never lost if the resulting save fails - it stays queued for retry, exactly like the existing pause/resume actions', async () => {
  const sandbox = createSandbox(KNOWN_IDS);
  seedActiveSession(sandbox);
  let cleared = false;
  const plugin = {
    getPendingActions() { return Promise.resolve({ actions: [{ seq: 1, type: 'logset', sessionId: 'sess1', exId: 'incline-db', index: 0, w: 20, r: 8, ts: 5000 }] }); },
    clearPendingActions() { cleared = true; return Promise.resolve(); },
    show() { return Promise.resolve({}); },
    hide() { return Promise.resolve({}); },
  };
  sandbox.Capacitor = { isNativePlatform: () => true, Plugins: { WorkoutNotification: plugin } };
  const realSetItem = sandbox.localStorage.setItem.bind(sandbox.localStorage);
  let writesShouldFail = false;
  sandbox.localStorage.setItem = function (k, v) { if (writesShouldFail) throw new Error('QuotaExceededError'); return realSetItem(k, v); };

  assert.doesNotThrow(() => boot(sandbox));
  writesShouldFail = true;
  await new Promise((resolve) => setTimeout(resolve, 900));

  assert.equal(cleared, false, 'a logset action whose resulting save failed must stay queued, never silently discarded');
});
test('smoke: a failed-save logset reconciliation never leaks into a later, unrelated render/notification push - the live session must stay exactly what localStorage still has until the save actually succeeds, then a retry applies cleanly once storage recovers', async () => {
  const sandbox = createSandbox(KNOWN_IDS);
  seedActiveSession(sandbox);
  let cleared = false;
  const shownPayloads = [];
  const plugin = {
    getPendingActions() { return Promise.resolve({ actions: [{ seq: 1, type: 'logset', sessionId: 'sess1', exId: 'incline-db', index: 0, w: 20, r: 8, ts: 5000 }] }); },
    clearPendingActions() { cleared = true; return Promise.resolve(); },
    show(p) { shownPayloads.push(p); return Promise.resolve({}); },
    hide() { return Promise.resolve({}); },
  };
  sandbox.Capacitor = { isNativePlatform: () => true, Plugins: { WorkoutNotification: plugin } };
  const realSetItem = sandbox.localStorage.setItem.bind(sandbox.localStorage);
  let writesShouldFail = false;
  sandbox.localStorage.setItem = function (k, v) { if (writesShouldFail) throw new Error('QuotaExceededError'); return realSetItem(k, v); };

  assert.doesNotThrow(() => boot(sandbox));
  writesShouldFail = true;
  await new Promise((resolve) => setTimeout(resolve, 900)); // the startup reconciliation runs and its save fails
  assert.equal(cleared, false);
  shownPayloads.length = 0; // only care about pushes that happen AFTER the failed reconciliation

  // A completely unrelated user action - switching tabs - which calls render() and therefore
  // pushNotificationState() unconditionally, with no connection to the failed reconciliation.
  // Mutating the LIVE session before attempting the save (instead of a disposable clone, only
  // swapped in once the save actually succeeds) would let exactly this kind of incidental
  // render() push the unsaved set to native as if it were durable - which would make native's
  // pruneNativeCommits discard its own only remaining copy of it, losing the set entirely.
  fireClick(sandbox, 'tab', { tab: 'food' });

  assert.ok(shownPayloads.length > 0, 'expected the tab switch to still refresh the notification as normal');
  const leaked = shownPayloads.some((p) => p.committedLog && p.committedLog['incline-db'] && p.committedLog['incline-db'][0]);
  assert.equal(leaked, false, 'the unsaved logset must never leak into an unrelated render before its save has actually succeeded');
  const stillOld = JSON.parse(sandbox.localStorage.getItem('vshape-tracker-v1'));
  assert.equal(stillOld.days['2026-01-01'].sessions[0].log['incline-db'], undefined, 'localStorage itself must still be untouched while the save keeps failing');

  // Storage recovers; the same still-queued action must now apply cleanly on retry.
  writesShouldFail = false;
  (sandbox.__listeners.visibilitychange || []).forEach((fn) => fn());
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(cleared, true, 'once storage recovers, the retried action must be applied and acknowledged');
  const savedNow = JSON.parse(sandbox.localStorage.getItem('vshape-tracker-v1'));
  assert.deepEqual(savedNow.days['2026-01-01'].sessions[0].log['incline-db'][0], { w: 20, r: 8 });
});
test('smoke: the diagnostic export distinguishes present, pending, quarantined/hidden and pending-native set records', async () => {
  const sandbox = createSandbox(KNOWN_IDS);
  const finishedSession = {
    id: 'sess1', day: 'push', label: null, startedAt: 1000, finishedAt: 2000, status: 'finished',
    pausedAt: null, pausedMs: 0, lastAppliedSeq: 0, log: { 'incline-db': [{ w: 20, r: 8 }] }, rest: null,
    exSnapshot: [
      { id: 'incline-db', name: 'Incline DB Press', sets: 1, lo: 6, hi: 10, rest: 90, inc: 2, start: 18, muscle: 'Chest' },
      { id: 'machine-chest', name: 'Machine Chest Press', sets: 1, lo: 8, hi: 12, rest: 120, inc: 5, start: 40, muscle: 'Chest' },
    ],
  };
  const seeded = {
    schema: 3,
    profile: { targets: { kcal: 2350, protein: 160, steps: 20000, water: 3000 }, weights: {}, customFoods: [] },
    days: {
      '2026-01-01': {
        date: '2026-01-01', food: [], steps: 0, stepsSource: null, water: 0,
        sessions: [finishedSession],
        // machine-chest's bad set has already been pulled OUT of session.log by a previous
        // quarantineInvalidSets pass (simulated here exactly as it would look on disk) -
        // "hidden"/quarantined, distinct from a set that was simply never logged.
        quarantine: { sets: [{ sessionId: 'sess1', exId: 'machine-chest', index: 0, value: { w: -5, r: 8 }, reason: 'negative-weight-not-allowed' }] },
      },
    },
    active: null,
  };
  sandbox.localStorage.setItem('vshape-tracker-v1', JSON.stringify(seeded));

  const plugin = {
    getPendingActions() { return Promise.resolve({ actions: [] }); },
    clearPendingActions() { return Promise.resolve(); },
    show() { return Promise.resolve({}); },
    hide() { return Promise.resolve({}); },
    // One still-unreconciled native action (pending) and one native-commit cache entry (also
    // pending, from the notification's own "sets committed since the last JS sync" view) -
    // both distinct from anything already settled in session.log.
    getDiagnostics() {
      return Promise.resolve({ journal: { queue: [{ seq: 5, type: 'logset', exId: 'machine-chest', index: 0 }], nativeCommits: [{ exId: 'machine-chest', index: 0, w: 42, r: 10 }] } });
    },
  };
  sandbox.Capacitor = { isNativePlatform: () => true, Plugins: { WorkoutNotification: plugin } };

  assert.doesNotThrow(() => boot(sandbox));

  let lastBlobContent = null;
  const RealBlob = sandbox.Blob;
  sandbox.Blob = function (parts, opts) { lastBlobContent = parts[0]; return new RealBlob(parts, opts); };

  fireClick(sandbox, 'settings');
  fireClick(sandbox, 'exportdiagnostics');
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.ok(lastBlobContent, 'expected the diagnostic export to produce a downloadable file');
  const report = JSON.parse(lastBlobContent);
  const day = report.live.days.find((d) => d.date === '2026-01-01');
  const session = day.sessions[0];

  const inclineEx = session.exercises.find((e) => e.exId === 'incline-db');
  assert.deepEqual(inclineEx.loggedIndexes, [0], 'expected the actually-logged set to show up as present');

  const machineEx = session.exercises.find((e) => e.exId === 'machine-chest');
  assert.deepEqual(machineEx.pendingIndexes, [0], 'from session.log alone a quarantined set looks identical to one simply never logged');
  assert.equal(machineEx.incompleteOnFinish, true, 'flagged because the session is finished yet this exercise still has an unlogged index - worth a second look');

  assert.equal(day.quarantine.length, 1, 'the quarantined record itself must be listed too, which is what actually distinguishes "hidden" from "missing"');
  assert.equal(day.quarantine[0].reason, 'negative-weight-not-allowed');
  assert.deepEqual(day.quarantine[0].value, { w: -5, r: 8 });

  assert.equal(report.native.pendingNativeActionCount, 1, 'expected the still-unreconciled native action to be surfaced distinctly');
  assert.equal(report.native.pendingNativeCommitCount, 1, 'expected the native commit cache to be surfaced distinctly too');
});
test('smoke: a stale logset action (seq already applied) is rejected and cannot re-log or overwrite a set', async () => {
  const sandbox = createSandbox(KNOWN_IDS);
  seedActiveSession(sandbox, { lastAppliedSeq: 5, log: { 'incline-db': [{ w: 20, r: 8 }] } });
  let cleared = false;
  const plugin = {
    getPendingActions() { return Promise.resolve({ actions: [{ seq: 5, type: 'logset', sessionId: 'sess1', exId: 'incline-db', index: 1, w: 99, r: 99, ts: 5000 }] }); },
    clearPendingActions() { cleared = true; return Promise.resolve(); },
    show() { return Promise.resolve({}); },
    hide() { return Promise.resolve({}); },
  };
  sandbox.Capacitor = { isNativePlatform: () => true, Plugins: { WorkoutNotification: plugin } };
  assert.doesNotThrow(() => boot(sandbox));
  await new Promise((resolve) => setTimeout(resolve, 900));

  const saved = JSON.parse(sandbox.localStorage.getItem('vshape-tracker-v1'));
  const session = saved.days['2026-01-01'].sessions[0];
  assert.equal(session.log['incline-db'][1], undefined, 'a stale action must never log a new set');
  assert.equal(cleared, true, 'a skip-only (nothing applied) batch is always safe to acknowledge, so it should still be cleared');
});
test('smoke: a rejected logset (e.g. an invalid weight) still refreshes the notification instead of leaving it stuck on "Updating…"', async () => {
  const sandbox = createSandbox(KNOWN_IDS);
  seedActiveSession(sandbox);
  const shownPayloads = [];
  const plugin = {
    getPendingActions() { return Promise.resolve({ actions: [{ seq: 1, type: 'logset', sessionId: 'sess1', exId: 'incline-db', index: 0, w: -50, r: 8, ts: 5000 }] }); },
    clearPendingActions() { return Promise.resolve(); },
    show(p) { shownPayloads.push(p); return Promise.resolve({}); },
    hide() { return Promise.resolve({}); },
  };
  sandbox.Capacitor = { isNativePlatform: () => true, Plugins: { WorkoutNotification: plugin } };
  assert.doesNotThrow(() => boot(sandbox));
  // Let boot's own incidental async work (e.g. loadPhotos()'s fake-IndexedDB callback, which
  // also triggers a render()/show()) settle first, so only a show() caused by reconciling the
  // rejected batch below counts.
  await new Promise((resolve) => setTimeout(resolve, 100));
  shownPayloads.length = 0;
  await new Promise((resolve) => setTimeout(resolve, 800));

  const saved = JSON.parse(sandbox.localStorage.getItem('vshape-tracker-v1'));
  assert.equal(saved.days['2026-01-01'].sessions[0].log['incline-db'], undefined, 'an invalid (negative, non-assisted) weight must never be recorded');
  assert.ok(shownPayloads.length > 0, 'expected a NEW notification redraw triggered by reconciling the rejected batch, not just the one at boot - otherwise it is left stuck on a stale "Updating…" label forever');
  const last = shownPayloads[shownPayloads.length - 1];
  assert.equal(last.state, 'ready', 'the rejected set is still pending, so the notification must keep showing it as such');
});
test('smoke: denying the workout notification permission is recorded and persists, without breaking the rest of the app', async () => {
  const sandbox = createSandbox(KNOWN_IDS);
  const plugin = {
    requestPermission() { return Promise.resolve({ status: 'denied' }); },
    getPendingActions() { return Promise.resolve({ actions: [] }); },
    clearPendingActions() { return Promise.resolve(); },
    show() { return Promise.resolve({}); },
    hide() { return Promise.resolve({}); },
  };
  sandbox.Capacitor = { isNativePlatform: () => true, Plugins: { WorkoutNotification: plugin } };
  boot(sandbox);
  fireClick(sandbox, 'settings');
  fireClick(sandbox, 'requestworkoutnotif');
  await new Promise((resolve) => setTimeout(resolve, 0));

  const saved = JSON.parse(sandbox.localStorage.getItem('vshape-tracker-v1'));
  assert.equal(saved.profile.notifPermission, 'denied');
  const html = sheetHTML(sandbox);
  assert.ok(html.includes('Off. The workout still tracks fine inside the app.'), 'expected the settings screen to clearly explain the denied state rather than silently failing');
});

test('smoke: data from a newer schema is locked, not flattened or discarded', () => {
  const sandbox = createSandbox(KNOWN_IDS);
  sandbox.localStorage.setItem('vshape-tracker-v1', JSON.stringify({ schema: 99, profile: {}, days: { x: { sessions: [] } } }));
  assert.doesNotThrow(() => boot(sandbox));
  // The original, un-mangled blob must still be sitting under the same key.
  const saved = JSON.parse(sandbox.localStorage.getItem('vshape-tracker-v1'));
  assert.equal(saved.schema, 99);
});

test('smoke: the plan builder can create a plan, add a day and a custom exercise, and a logged set survives into volume analytics', () => {
  const sandbox = createSandbox(KNOWN_IDS);
  boot(sandbox);

  fireClick(sandbox, 'settings');
  assert.ok(sheetHTML(sandbox).includes('Default 5-Day Split'), 'expected the seeded default plan to be listed in Settings');

  fireClick(sandbox, 'plannew');
  let html = sheetHTML(sandbox);
  assert.ok(html.includes('Edit plan'), 'expected the new plan editor to open immediately after creating a plan');
  const planId = html.match(/data-act="templateadd" data-planid="([^"]+)"/)[1];

  fireClick(sandbox, 'templateadd', { planid: planId });
  html = sheetHTML(sandbox);
  assert.ok(html.includes('Edit workout'), 'expected the new workout template editor to open immediately after adding one');

  fireClick(sandbox, 'exadd');
  fireClick(sandbox, 'exnewcustom');
  setVal(sandbox, 'ex-name', 'Smoke Test Press');
  setVal(sandbox, 'ex-muscle', 'Chest');
  setVal(sandbox, 'ex-sets', '1');
  setVal(sandbox, 'ex-rest', '60');
  setVal(sandbox, 'ex-lo', '8');
  setVal(sandbox, 'ex-hi', '12');
  setVal(sandbox, 'ex-start', '20');
  setVal(sandbox, 'ex-inc', '2');
  fireClick(sandbox, 'exsave');
  html = sheetHTML(sandbox);
  assert.ok(html.includes('Smoke Test Press'), 'expected the newly saved custom exercise to appear back on the workout template editor');
  const exIdMatch = html.match(/data-act="exedit" data-id="([^"]+)"/);
  assert.ok(exIdMatch, 'expected the saved custom exercise to have an id');
  const exId = exIdMatch[1];

  fireClick(sandbox, 'templatebacktoplan');
  html = sheetHTML(sandbox);
  const templateId = html.match(/data-act="templatesel" data-id="([^"]+)"/)[1];

  // Schedule the new template on today's real weekday so curWd()/autoDay() picks it up once this plan is active.
  const todayWeekday = new Date().getDay();
  fireClick(sandbox, 'weekdaysel', { wd: String(todayWeekday) });
  html = sheetHTML(sandbox);
  assert.ok(html.includes('New workout'), 'expected the weekday-assignment sheet to list the new workout template');
  fireClick(sandbox, 'weekdaytoggle', { wd: String(todayWeekday), id: templateId });

  fireClick(sandbox, 'planactivate', { id: planId });
  fireClick(sandbox, 'closesheet');

  fireClick(sandbox, 'tab', { tab: 'train' });
  html = sandbox.document.querySelector('#app').innerHTML;
  assert.ok(html.includes('Smoke Test Press'), 'expected the Train tab to show the custom exercise once its plan is active and scheduled for today');

  fireClick(sandbox, 'startworkout');
  // Log the one set: a real tap reads the row's inputs via the clicked element's closest('.set'); this fake target stands in for that row.
  const row = { dataset: { ex: exId, i: '0' }, closest(sel) { return sel === '.set' ? row : null; }, querySelector(sel) { return sel === '[data-f=w]' ? { value: '20' } : sel === '[data-f=r]' ? { value: '10' } : null; } };
  const logTarget = { dataset: { act: 'logset' }, closest(sel) { return sel === '[data-act]' ? logTarget : (sel === '.set' ? row : null); } };
  (sandbox.__listeners.click || []).forEach((fn) => fn({ target: logTarget }));

  fireClick(sandbox, 'finishworkout');
  fireClick(sandbox, 'finishworkout2');

  fireClick(sandbox, 'tab', { tab: 'progress' });
  html = sandbox.document.querySelector('#app').innerHTML;
  assert.ok(html.includes('Chest'), 'expected the logged set to show up in the weekly volume-by-muscle card');

  const saved = JSON.parse(sandbox.localStorage.getItem('vshape-tracker-v1'));
  const loggedSession = Object.values(saved.days).flatMap((d) => d.sessions).find((s) => s.status === 'finished');
  assert.ok(loggedSession, 'expected the finished session to be persisted');
  assert.ok(loggedSession.exSnapshot.some((e) => e.name === 'Smoke Test Press'), 'expected the session to carry its own frozen exercise snapshot');
});

test('smoke: a plan still on the pre-weekday-schedule shape (days/weekdays/rest) is upgraded to templates+schedule on load, preserving ids and existing sessions', () => {
  const sandbox = createSandbox(KNOWN_IDS);
  const oldShapePlan = {
    id: 'plan1', name: 'My Split',
    days: [
      { id: 'push', name: 'Push A', tag: 'Chest', cue: 'Go', rest: false, weekdays: [1], ex: [{ id: 'incline-db', name: 'Incline DB Press', sets: 3, lo: 6, hi: 10, rest: 150, inc: 2, start: 18, muscle: 'Chest', cue: 'x' }] },
      { id: 'restday', name: 'Rest', tag: '', cue: '', rest: true, weekdays: [4], ex: [] },
    ],
  };
  const seeded = {
    schema: 3,
    profile: { targets: { kcal: 2350, protein: 160, steps: 20000, water: 3000 }, weights: {}, customFoods: [] },
    days: {
      '2026-01-05': { // a Monday
        date: '2026-01-05', food: [], steps: 0, stepsSource: null, water: 0,
        sessions: [{ id: 's1', day: 'push', planId: 'plan1', dayId: 'push', dayName: 'Push A', dayTag: 'Chest', dayCue: 'Go', exSnapshot: oldShapePlan.days[0].ex, label: null, startedAt: 1000, finishedAt: 5000, status: 'finished', pausedAt: null, pausedMs: 0, lastAppliedSeq: 0, log: { 'incline-db': [{ w: 20, r: 8 }] }, rest: null }],
        quarantine: { sets: [], food: [] },
      },
    },
    plans: [oldShapePlan],
    activePlanId: 'plan1',
  };
  sandbox.localStorage.setItem('vshape-tracker-v1', JSON.stringify(seeded));
  assert.doesNotThrow(() => boot(sandbox));

  const saved = JSON.parse(sandbox.localStorage.getItem('vshape-tracker-v1'));
  const plan = saved.plans[0];
  assert.equal(plan.days, undefined, 'old `days` array should be gone once upgraded');
  assert.equal(plan.templates.length, 1, 'the rest day never becomes a template');
  assert.equal(plan.templates[0].id, 'push', 'template id must stay equal to the old day id a session already points at');
  assert.deepEqual(plan.schedule['1'], ['push']);
  assert.deepEqual(plan.schedule['4'], []);
  // The pre-existing finished session must still be intact and still findable by its day key.
  assert.equal(saved.days['2026-01-05'].sessions[0].log['incline-db'][0].w, 20);

  fireClick(sandbox, 'gotod', { d: '2026-01-05' });
  fireClick(sandbox, 'tab', { tab: 'train' });
  fireClick(sandbox, 'wd', { k: 'push' });
  const html = sandbox.document.querySelector('#app').innerHTML;
  assert.ok(html.includes('Finished'), 'the migrated session must still be found by its (preserved) template id');
});

test('smoke: when a weekday has more than one workout scheduled, Train explicitly asks instead of silently picking one', () => {
  const sandbox = createSandbox(KNOWN_IDS);
  boot(sandbox);

  fireClick(sandbox, 'settings');
  fireClick(sandbox, 'plannew');
  let html = sheetHTML(sandbox);
  const planId = html.match(/data-act="templateadd" data-planid="([^"]+)"/)[1];

  fireClick(sandbox, 'templateadd', { planid: planId });
  fireClick(sandbox, 'templatebacktoplan');
  html = sheetHTML(sandbox);
  const firstId = html.match(/data-act="templatesel" data-id="([^"]+)"/)[1];

  fireClick(sandbox, 'templateadd', { planid: planId });
  fireClick(sandbox, 'templatebacktoplan');
  html = sheetHTML(sandbox);
  const ids = [...html.matchAll(/data-act="templatesel" data-id="([^"]+)"/g)].map((m) => m[1]);
  const secondId = ids.find((id) => id !== firstId);
  assert.ok(secondId, 'expected a second workout template to exist');

  const todayWeekday = new Date().getDay();
  fireClick(sandbox, 'weekdaysel', { wd: String(todayWeekday) });
  fireClick(sandbox, 'weekdaytoggle', { wd: String(todayWeekday), id: firstId });
  fireClick(sandbox, 'weekdaytoggle', { wd: String(todayWeekday), id: secondId });
  fireClick(sandbox, 'planactivate', { id: planId });
  fireClick(sandbox, 'closesheet');

  fireClick(sandbox, 'tab', { tab: 'train' });
  html = sandbox.document.querySelector('#app').innerHTML;
  assert.ok(html.includes('More than one workout is scheduled today'), 'expected an explicit choice prompt rather than silently picking the first scheduled workout');
});

// 2026-01-05 is a Monday (the default plan's scheduled Push A day) and 2026-01-08 is a
// Thursday (the default plan's scheduled rest day) - fixed, deterministic dates so these
// tests do not depend on what day it actually is when they run.
// 2026-01-05 is a Monday - the default plan's scheduled Push A day (see the other
// override tests above for the same fixed-date convention).
test('smoke: CRITICAL - re-viewing a workout day right after finishing it must still show the logged weights/reps, not blank rows (the data itself is not meant to be touched by finishing at all)', () => {
  const sandbox = createSandbox(KNOWN_IDS);
  const finishedSession = {
    id: 'sess-finished', day: 'push', label: null, startedAt: 1000, finishedAt: 50000, status: 'finished',
    pausedAt: null, pausedMs: 0, lastAppliedSeq: 0,
    log: { 'incline-db': [{ w: 20, r: 8 }, { w: 20, r: 7 }] },
    rest: null,
    planId: null, dayId: 'push', dayName: 'Push A', dayTag: 'Chest, shoulders, triceps', dayCue: 'x',
    // A realistic frozen snapshot, exactly like startOrGetSession actually captures at
    // creation time - not the live plan template, so this also checks that re-viewing a
    // finished session keeps showing ITS OWN snapshot even if the live plan is edited later.
    exSnapshot: [{ id: 'incline-db', name: 'Incline Dumbbell Press', sets: 3, lo: 6, hi: 10, rest: 150, inc: 2, start: 18, muscle: 'Upper chest', cue: 'x' }],
  };
  const seeded = {
    schema: 3,
    profile: { targets: { kcal: 2350, protein: 160, steps: 20000, water: 3000 }, weights: {}, customFoods: [] },
    days: { '2026-01-05': { date: '2026-01-05', food: [], steps: 0, stepsSource: null, water: 0, sessions: [finishedSession], quarantine: { sets: [], food: [] } } },
    active: null, // exactly like right after finishworkout2 sets S.active = null
  };
  sandbox.localStorage.setItem('vshape-tracker-v1', JSON.stringify(seeded));
  boot(sandbox);

  fireClick(sandbox, 'gotod', { d: '2026-01-05' });
  fireClick(sandbox, 'tab', { tab: 'train' });
  const html = sandbox.document.querySelector('#app').innerHTML;

  assert.ok(html.includes('Finished'), 'expected the lifecycle bar to say the workout is finished');
  // The actual bug: viewTrain()/setsDone() only ever read from openSessionFor(), which by
  // design excludes a finished session - so the moment there is no OPEN session, the
  // exercise rows and the header count both silently read an empty {} log instead of the
  // finished session's real one, even though session.log itself was never touched.
  assert.ok(html.includes('value="20"'), 'expected the logged 20kg to still be shown on the form, not reset/blanked out');
  assert.ok(html.includes('>2/3<'), 'expected the header\'s sets-done count to reflect the 2 logged sets out of 3, not 0/3');
  assert.ok(html.includes('disabled'), 'a finished session\'s sets must render read-only, not as fresh editable/loggable rows');

  // And the underlying data was never actually touched in the first place.
  const saved = JSON.parse(sandbox.localStorage.getItem('vshape-tracker-v1'));
  assert.deepEqual(saved.days['2026-01-05'].sessions[0].log['incline-db'], [{ w: 20, r: 8 }, { w: 20, r: 7 }], 'the saved session log itself must be completely unaffected by merely re-viewing the day after finishing');
});
test('smoke: "Rest Today" and "Skip Workout" on a scheduled training day override it to rest for that date only, without creating a session, touching other dates, or rewriting the permanent schedule', () => {
  const sandbox = createSandbox(KNOWN_IDS);
  boot(sandbox); // a brand-new install never writes to localStorage until the first save, so there is nothing to snapshot yet - the comparison below is made between the two post-override saves instead
  const scheduleOf = (blob) => JSON.stringify(blob.plans.map((p) => ({ id: p.id, schedule: p.schedule, templates: p.templates })));

  fireClick(sandbox, 'gotod', { d: '2026-01-05' });
  fireClick(sandbox, 'tab', { tab: 'train' });
  let html = sandbox.document.querySelector('#app').innerHTML;
  assert.ok(html.includes('Start workout'), 'expected the scheduled Push A day to show the normal start-workout bar');
  assert.ok(html.includes('data-act="resttoday"') && html.includes('data-act="skipworkout"'), 'expected Rest Today and Skip Workout to be offered on a scheduled training day');

  fireClick(sandbox, 'resttoday');
  html = sandbox.document.querySelector('#app').innerHTML;
  assert.ok(html.includes('Rest day'), 'Rest Today must redirect this one date to the rest-day view');
  assert.ok(html.includes('Marked as rest today.'), 'expected an explicit confirmation of the override');
  assert.ok(html.includes('data-act="undooverride"'), 'expected an Undo control for the override');
  let saved = JSON.parse(sandbox.localStorage.getItem('vshape-tracker-v1'));
  assert.deepEqual(saved.days['2026-01-05'].override, { type: 'rest', reason: 'rest' });
  assert.equal((saved.days['2026-01-05'].sessions || []).length, 0, 'Rest Today must never create a session or award a PR');
  const scheduleAfterRest = scheduleOf(saved);

  // 2026-01-06 is the very next day (Tuesday, scheduled Pull A) - a date-specific override on
  // the 5th must never leak into it.
  fireClick(sandbox, 'gotod', { d: '2026-01-06' });
  html = sandbox.document.querySelector('#app').innerHTML;
  assert.ok(html.includes('Start workout'), 'an override on one date must not affect the very next, unrelated date');
  assert.equal(saved.days['2026-01-06'], undefined, 'merely viewing the next day must not itself write anything');

  fireClick(sandbox, 'gotod', { d: '2026-01-05' });
  fireClick(sandbox, 'undooverride');
  html = sandbox.document.querySelector('#app').innerHTML;
  assert.ok(html.includes('Start workout'), 'Undo must restore the normal scheduled-workout view');
  saved = JSON.parse(sandbox.localStorage.getItem('vshape-tracker-v1'));
  assert.equal(saved.days['2026-01-05'].override, null);

  fireClick(sandbox, 'skipworkout');
  html = sandbox.document.querySelector('#app').innerHTML;
  assert.ok(html.includes('Workout skipped for today.'), 'expected Skip Workout to be distinguishable from Rest Today');
  saved = JSON.parse(sandbox.localStorage.getItem('vshape-tracker-v1'));
  assert.deepEqual(saved.days['2026-01-05'].override, { type: 'rest', reason: 'skip' });
  assert.equal((saved.days['2026-01-05'].sessions || []).length, 0, 'Skip Workout must never create a session or award a PR either');
  assert.equal(scheduleOf(saved), scheduleAfterRest, 'the recurring weekly schedule/templates must stay byte-for-byte identical across every one of these date-specific overrides');
});

test('smoke: a scheduled Thursday rest day shows ONLY the deliberate Rest Day card, never the old quick-pick workout pills that could silently swap it out with no way back', () => {
  const sandbox = createSandbox(KNOWN_IDS);
  boot(sandbox);
  fireClick(sandbox, 'gotod', { d: '2026-01-08' }); // Thursday
  fireClick(sandbox, 'tab', { tab: 'train' });
  const html = sandbox.document.querySelector('#app').innerHTML;
  assert.ok(html.includes('Rest day'), 'expected the Rest Day card');
  // The old pill mechanism (data-act="wd") bypasses the override system entirely: tapping one
  // sets the ephemeral ui.wd, which has no Undo and silently replaces the Rest Day card with
  // a workout on every subsequent render until an explicit date navigation happens - exactly
  // what made Thursday "stop showing Rest Day" during real-device testing. The only way to
  // train on a rest day now must be the deliberate, undoable "Skip rest & train" override.
  assert.ok(!html.includes('data-act="wd"'), 'the quick-pick pills must not be offered on a scheduled rest day');
  assert.ok(html.includes('data-act="skiprestopen"'), 'the deliberate Skip rest & train control must still be there');
});
test('smoke: "Skip Rest & Train" on a scheduled rest day lets the lifter pick a workout template for that date only, without touching previous sessions, other dates, or the permanent schedule, and is undoable back to rest', () => {
  const sandbox = createSandbox(KNOWN_IDS);
  // A pre-existing finished session on an unrelated earlier date, whose survival we check
  // explicitly below ("previous sessions remain untouched").
  const priorSession = {
    id: 'sess-old', day: 'push', label: null, startedAt: 1000, finishedAt: 2000, status: 'finished',
    pausedAt: null, pausedMs: 0, lastAppliedSeq: 0, log: { 'incline-db': [{ w: 20, r: 8 }] }, rest: null,
    exSnapshot: [{ id: 'incline-db', name: 'Incline DB Press', sets: 1, lo: 6, hi: 10, rest: 90, inc: 2, start: 18, muscle: 'Chest' }],
  };
  const seeded = {
    schema: 3,
    profile: { targets: { kcal: 2350, protein: 160, steps: 20000, water: 3000 }, weights: {}, customFoods: [] },
    days: { '2025-12-01': { date: '2025-12-01', food: [], steps: 0, stepsSource: null, water: 0, sessions: [priorSession], quarantine: { sets: [], food: [] } } },
    active: null,
  };
  sandbox.localStorage.setItem('vshape-tracker-v1', JSON.stringify(seeded));
  boot(sandbox);
  const scheduleBefore = JSON.stringify(JSON.parse(sandbox.localStorage.getItem('vshape-tracker-v1')).plans.map((p) => ({ id: p.id, schedule: p.schedule, templates: p.templates })));

  fireClick(sandbox, 'gotod', { d: '2026-01-08' });
  fireClick(sandbox, 'tab', { tab: 'train' });
  let html = sandbox.document.querySelector('#app').innerHTML;
  assert.ok(html.includes('Rest day'), 'expected the scheduled Thursday rest day to show the rest-day card by default');
  assert.ok(html.includes('data-act="skiprestopen"'), 'expected a "Skip rest & train" control on a scheduled rest day');

  fireClick(sandbox, 'skiprestopen');
  html = sandbox.document.querySelector('#app').innerHTML;
  assert.ok(html.includes('data-act="traininstead" data-k="legsA"'), 'expected every plan template, including ones not normally scheduled today, to be offered');

  fireClick(sandbox, 'traininstead', { k: 'legsA' });
  html = sandbox.document.querySelector('#app').innerHTML;
  assert.ok(html.includes('Start workout'), 'picking a template must land on its normal start-workout view, never an auto-started session');
  assert.ok(html.includes('Training instead of your scheduled rest day.'), 'expected the override to be clearly flagged');
  let saved = JSON.parse(sandbox.localStorage.getItem('vshape-tracker-v1'));
  assert.deepEqual(saved.days['2026-01-08'].override, { type: 'train', templateId: 'legsA' });
  assert.equal((saved.days['2026-01-08'].sessions || []).length, 0, 'choosing to train instead must not itself create a session');
  assert.deepEqual(saved.days['2025-12-01'].sessions[0], priorSession, 'a previously-logged, unrelated finished session must be left byte-for-byte untouched');
  const scheduleAfter = JSON.stringify(saved.plans.map((p) => ({ id: p.id, schedule: p.schedule, templates: p.templates })));
  assert.equal(scheduleAfter, scheduleBefore, 'the recurring weekly schedule/templates must be unchanged by this date-specific override too');

  // The very next Sunday rest day on the same plan must still show as a normal rest day -
  // this override is scoped to 2026-01-08 only, not "every Thursday" or "every rest day".
  fireClick(sandbox, 'gotod', { d: '2026-01-11' });
  html = sandbox.document.querySelector('#app').innerHTML;
  assert.ok(html.includes('Rest day') && !html.includes('Training instead'), 'the next scheduled rest day must be unaffected by the override on a different date');

  fireClick(sandbox, 'gotod', { d: '2026-01-08' });
  fireClick(sandbox, 'undooverride');
  html = sandbox.document.querySelector('#app').innerHTML;
  assert.ok(html.includes('Rest day'), 'Undo must restore the scheduled rest day');
  saved = JSON.parse(sandbox.localStorage.getItem('vshape-tracker-v1'));
  assert.equal(saved.days['2026-01-08'].override, null);
});

test('smoke: the in-app rest countdown redraws to the correct remaining time as soon as the app becomes visible again, instead of staying frozen on whatever was last painted', () => {
  const sandbox = createSandbox(KNOWN_IDS);
  const deadline = Date.now() + 45000;
  seedActiveSession(sandbox, { rest: { exId: 'incline-db', label: 'Incline DB Press', startedAt: Date.now() - 30000, durationMs: 75000, deadline, paused: false, pausedRemainingMs: null, done: false } });
  boot(sandbox);

  const timerEl = sandbox.document.querySelector('#timer');
  assert.equal(timerEl.hidden, false, 'expected the rest widget to be visible on boot since the session has an in-progress rest');
  assert.ok(timerEl.innerHTML.includes('id="tval"'), 'expected a live countdown value element');

  // Simulate the WebView having frozen/thrown away the running interval while the app was
  // minimised (the actual real-device bug: the display is stale, but the underlying deadline
  // in session.rest is still correct) by blanking out what is currently painted.
  timerEl.innerHTML = '';

  // document.hidden is false in this fake environment (never set), matching "we have just
  // become visible again" - the same condition the real visibilitychange handler checks.
  (sandbox.__listeners.visibilitychange || []).forEach((fn) => fn());

  assert.ok(timerEl.innerHTML.includes('id="tval"'), 'becoming visible again must force the countdown to redraw, not leave it blank/frozen');
  assert.equal(timerEl.hidden, false);
});

test('smoke: the rest countdown keeps ticking down on its own every ~500ms while the app stays continuously visible (no visibilitychange needed), with never more than one interval alive at once', async () => {
  const sandbox = createSandbox(KNOWN_IDS);
  const deadline = Date.now() + 1200;
  seedActiveSession(sandbox, { rest: { exId: 'incline-db', label: 'Incline DB Press', startedAt: Date.now() - 1000, durationMs: 2200, deadline, paused: false, pausedRemainingMs: null, done: false } });

  // Count how many distinct intervals get created/torn down, so a regression that leaves a
  // second ticking interval running alongside the first (e.g. a future kickTimer()/
  // resumeTickIfNeeded() call that forgets to clear the old one first) would be caught here,
  // not just "it still looks right on screen".
  let active = 0, maxActive = 0, totalStarts = 0;
  const realSetInterval = sandbox.setInterval, realClearInterval = sandbox.clearInterval;
  sandbox.setInterval = function (fn, ms) { active++; totalStarts++; maxActive = Math.max(maxActive, active); return realSetInterval(fn, ms); };
  sandbox.clearInterval = function (id) { if (id != null) active = Math.max(0, active - 1); return realClearInterval(id); };

  boot(sandbox); // boot's own resumeTickIfNeeded() call must start the one live interval, unprompted by any visibilitychange

  assert.equal(totalStarts, 1, 'expected exactly one interval to be started on boot while a rest is already in progress');
  assert.ok(maxActive <= 1, 'must never have more than one rest-ticking interval alive at the same time');

  const tval = sandbox.document.querySelector('#tval');
  const before = tval.textContent;
  assert.ok(before && before !== 'Go', 'expected a live, not-yet-finished countdown value right after boot');

  // No visibilitychange and no click - just real elapsed time, exactly like the app sitting
  // open and foregrounded the whole time. This is what proves the countdown ticks on its own
  // and does not depend on visibilitychange firing to ever update again.
  await new Promise((resolve) => setTimeout(resolve, 1700));

  assert.equal(tval.textContent, 'Go', 'the countdown must have ticked down to completion by itself while continuously visible');
  assert.ok(maxActive <= 1, 'still never more than one interval alive after the rest completed and self-cleared');
});
