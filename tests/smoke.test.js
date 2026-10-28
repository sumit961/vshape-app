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
const NUTRITION_SRC = fs.readFileSync(path.join(__dirname, '..', 'nutrition-advanced.js'), 'utf8');
const NUTRITION_UI_SRC = fs.readFileSync(path.join(__dirname, '..', 'nutrition-ui.js'), 'utf8');
const THEME_SRC = fs.readFileSync(path.join(__dirname, '..', 'theme-manager.js'), 'utf8');
const KNOWN_IDS = ['app', 'nav', 'toast', 'timer', 'sheet-root', 'csvIn', 'photoIn', 'backupIn', 'stepsIn'];

function boot(sandbox) {
  // Same script order as index.html: the nutrition/theme globals must exist before app.js's
  // top-level defProfile()/boot sequence references VShapeNutrition/VShapeThemes.
  vm.runInContext(NUTRITION_SRC, sandbox, { filename: 'nutrition-advanced.js' });
  vm.runInContext(NUTRITION_UI_SRC, sandbox, { filename: 'nutrition-ui.js' });
  vm.runInContext(THEME_SRC, sandbox, { filename: 'theme-manager.js' });
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
// Drives the real document.addEventListener('input', ...) delegate the same way typing into
// a field would, for the search boxes that filter a list live (goals/equipment/muscles).
function fireInput(sandbox, id, v) {
  const el = sandbox.document.querySelector('#' + id);
  el.value = v;
  (sandbox.__listeners.input || []).forEach((fn) => fn({ target: el }));
}
function attrValue(html, id) {
  const m = html.match(new RegExp('id="' + id + '"[^>]*?value="([^"]*)"'));
  return m ? m[1] : undefined;
}
// Drives the real #backupIn 'change' listener the same way picking a file would, now that
// env.js records element-level listeners and provides a fake FileReader.
function pickBackupFile(sandbox, obj) {
  const input = sandbox.document.querySelector('#backupIn');
  const handler = input._listeners.change[0];
  handler({ target: { files: [{ text: JSON.stringify(obj) }], value: '' } });
}
const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms || 30));
function readSafetyCopies(sandbox) {
  return new Promise((resolve) => {
    const req = sandbox.indexedDB.open('vshape', 2);
    req.onsuccess = () => {
      const tx = req.result.transaction('safety');
      const r = tx.objectStore('safety').getAll();
      tx.oncomplete = () => resolve(r.result);
    };
  });
}
function readPhotoStore(sandbox) {
  return new Promise((resolve) => {
    const req = sandbox.indexedDB.open('vshape', 2);
    req.onsuccess = () => {
      const tx = req.result.transaction('photos');
      const r = tx.objectStore('photos').getAll();
      tx.oncomplete = () => resolve(r.result);
    };
  });
}

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

/* ---------- Phase 3A: fitness profile & onboarding ---------- */
test('smoke: fresh install auto-opens the fitness-profile onboarding without blocking the normal Today view underneath', () => {
  const sandbox = createSandbox(KNOWN_IDS);
  boot(sandbox);
  const sheet = sheetHTML(sandbox);
  assert.ok(sheet.includes('Your fitness profile'), 'expected onboarding to auto-open on first boot');
  assert.ok(sheet.includes('data-act="obstart"'));
  const appHtml = sandbox.document.querySelector('#app').innerHTML;
  assert.ok(appHtml.includes('V-SHAPE'), 'the Today view underneath must still render normally, untouched by onboarding');
});

test('smoke: onboarding "about you" validates dob/height and treats every blank field as a deliberate skip, not an error', () => {
  const sandbox = createSandbox(KNOWN_IDS);
  boot(sandbox);
  fireClick(sandbox, 'obstart');

  setVal(sandbox, 'ob-dob', 'not-a-date');
  fireClick(sandbox, 'obnext');
  let saved = JSON.parse(sandbox.localStorage.getItem('vshape-tracker-v1'));
  assert.equal(saved.profile.fitness.onboardingStep, 1, 'an invalid date of birth must block advancing');

  setVal(sandbox, 'ob-dob', '');
  setVal(sandbox, 'ob-h-cm', '');
  setVal(sandbox, 'ob-w', '');
  setVal(sandbox, 'ob-tw', '');
  fireClick(sandbox, 'obnext');
  saved = JSON.parse(sandbox.localStorage.getItem('vshape-tracker-v1'));
  const fp = saved.profile.fitness;
  assert.equal(fp.onboardingStep, 2, 'leaving every field blank is a deliberate skip and must still advance');
  assert.equal(fp.dob, null);
  assert.equal(fp.heightCm, null);
  assert.equal(fp.currentWeightKg, null);
  assert.equal(fp.targetWeightKg, null);
});

test('smoke: onboarding "about you" saves dob/height/weight and converts correctly when the unit toggle is switched', () => {
  const sandbox = createSandbox(KNOWN_IDS);
  boot(sandbox);
  fireClick(sandbox, 'obstart');
  setVal(sandbox, 'ob-dob', '1995-06-15');
  setVal(sandbox, 'ob-h-cm', '180');
  setVal(sandbox, 'ob-w', '80');
  setVal(sandbox, 'ob-tw', '75');
  fireClick(sandbox, 'obnext');

  let saved = JSON.parse(sandbox.localStorage.getItem('vshape-tracker-v1'));
  let fp = saved.profile.fitness;
  assert.equal(fp.dob, '1995-06-15');
  assert.equal(fp.heightCm, 180);
  assert.equal(fp.currentWeightKg, 80);
  assert.equal(fp.targetWeightKg, 75);
  assert.equal(fp.onboardingStep, 2, 'expected the step to advance and persist for resuming later');

  // Back to "about you" and switch units - the canonical kg/cm values must redisplay converted.
  fireClick(sandbox, 'obback');
  fireClick(sandbox, 'obunitweight', { id: 'lb' });
  fireClick(sandbox, 'obunitheight', { id: 'ftin' });
  const html = sheetHTML(sandbox);
  assert.equal(attrValue(html, 'ob-w'), '176.4', '80kg must redisplay as 176.4 lb');
  assert.equal(attrValue(html, 'ob-tw'), '165.3', '75kg must redisplay as 165.3 lb');
  assert.equal(attrValue(html, 'ob-h-ft'), '5', '180cm must redisplay as 5 ft');
  assert.equal(attrValue(html, 'ob-h-in'), '11', '180cm must redisplay as 11 in');

  // Units themselves are saved immediately, same as every other toggle in this app.
  saved = JSON.parse(sandbox.localStorage.getItem('vshape-tracker-v1'));
  assert.deepEqual(saved.profile.fitness.units, { weight: 'lb', height: 'ftin' });
  // The canonical stored values must be unchanged by a pure display-unit switch.
  assert.equal(saved.profile.fitness.heightCm, 180);
  assert.equal(saved.profile.fitness.currentWeightKg, 80);
});

test('smoke: onboarding goal picker supports search, a custom user-defined goal, and primary/secondary mutual exclusivity', () => {
  const sandbox = createSandbox(KNOWN_IDS);
  boot(sandbox);
  fireClick(sandbox, 'obstart');
  fireClick(sandbox, 'obnext'); // about you (all blank) -> gender/experience
  fireClick(sandbox, 'obnext'); // -> goals
  assert.ok(sheetHTML(sandbox).includes('Your goals'));

  fireClick(sandbox, 'obgoalprimary', { id: 'strength' });
  fireClick(sandbox, 'obgoalsecondary', { id: 'endurance' });
  let saved = JSON.parse(sandbox.localStorage.getItem('vshape-tracker-v1'));
  assert.equal(saved.profile.fitness.primaryGoal, 'strength');
  assert.deepEqual(saved.profile.fitness.secondaryGoals, ['endurance']);

  // Choosing "endurance" as primary must pull it back out of secondary - never both at once.
  fireClick(sandbox, 'obgoalprimary', { id: 'endurance' });
  saved = JSON.parse(sandbox.localStorage.getItem('vshape-tracker-v1'));
  assert.equal(saved.profile.fitness.primaryGoal, 'endurance');
  assert.deepEqual(saved.profile.fitness.secondaryGoals, []);

  // obgoalprimary/obgoalsecondary/obaddgoal only replace their own list container's innerHTML
  // (so the search box above them never loses focus while filtering) - env.js's fake DOM does
  // not nest elements inside #sheet-root's own innerHTML string, so these targeted updates are
  // read back from the list containers directly, not from sheetHTML()'s stale full-sheet string.
  const goalLists = () => sandbox.document.querySelector('#ob-goal-primary-list').innerHTML + sandbox.document.querySelector('#ob-goal-secondary-list').innerHTML;
  fireInput(sandbox, 'ob-goal-q', 'fat');
  let lists = goalLists();
  assert.ok(lists.includes('Fat loss'));
  assert.ok(!lists.includes('Muscle gain'), 'the filtered list must hide non-matching goals');

  fireInput(sandbox, 'ob-goal-q', '');
  setVal(sandbox, 'ob-goal-custom', 'Climb a mountain');
  fireClick(sandbox, 'obaddgoal');
  saved = JSON.parse(sandbox.localStorage.getItem('vshape-tracker-v1'));
  assert.ok(saved.profile.fitness.customGoals.some((g) => g.label === 'Climb a mountain'));
  lists = goalLists();
  assert.ok(lists.includes('Climb a mountain'), 'the custom goal must appear immediately as a selectable chip');
});

test('smoke: onboarding equipment/muscle pickers are searchable multi-select, and support adding custom equipment', () => {
  const sandbox = createSandbox(KNOWN_IDS);
  boot(sandbox);
  fireClick(sandbox, 'obstart');
  for (let i = 0; i < 5; i++) fireClick(sandbox, 'obnext'); // about-you..schedule, all blank -> equipment & split
  assert.ok(sheetHTML(sandbox).includes('Where do you train?'));

  fireInput(sandbox, 'ob-equip-q', 'dumb');
  let list = sandbox.document.querySelector('#ob-equip-list').innerHTML;
  assert.ok(list.includes('Dumbbells'));
  assert.ok(!list.includes('Barbell'), 'the filtered equipment list must hide non-matching items');
  fireClick(sandbox, 'obequip', { id: 'dumbbells' });
  let saved = JSON.parse(sandbox.localStorage.getItem('vshape-tracker-v1'));
  assert.deepEqual(saved.profile.fitness.workoutPrefs.equipment, ['dumbbells']);

  fireInput(sandbox, 'ob-equip-q', '');
  setVal(sandbox, 'ob-equip-custom', 'Sandbag');
  fireClick(sandbox, 'obaddequip');
  saved = JSON.parse(sandbox.localStorage.getItem('vshape-tracker-v1'));
  const wp = saved.profile.fitness.workoutPrefs;
  assert.ok(wp.customEquipment.some((e) => e.label === 'Sandbag'));
  assert.ok(wp.equipment.indexOf(wp.customEquipment[0].id) >= 0, 'a newly added custom item is auto-selected');

  fireClick(sandbox, 'obnext'); // -> focus & preferences
  assert.ok(sheetHTML(sandbox).includes('Muscle groups to prioritise'));
  fireInput(sandbox, 'ob-muscle-q', 'chest');
  list = sandbox.document.querySelector('#ob-muscle-list').innerHTML;
  assert.ok(list.includes('Chest'));
  assert.ok(!list.includes('Hamstrings'), 'the filtered muscle list must hide non-matching groups');
  fireClick(sandbox, 'obmuscle', { id: 'chest' });
  saved = JSON.parse(sandbox.localStorage.getItem('vshape-tracker-v1'));
  assert.deepEqual(saved.profile.fitness.workoutPrefs.priorityMuscles, ['chest']);

  setVal(sandbox, 'ob-tag-pref', 'Barbell squat');
  fireClick(sandbox, 'obaddtag', { kind: 'pref' });
  setVal(sandbox, 'ob-tag-avoid', 'Overhead press');
  fireClick(sandbox, 'obaddtag', { kind: 'avoid' });
  saved = JSON.parse(sandbox.localStorage.getItem('vshape-tracker-v1'));
  assert.deepEqual(saved.profile.fitness.workoutPrefs.preferredExercises, ['Barbell squat']);
  assert.deepEqual(saved.profile.fitness.workoutPrefs.avoidExercises, ['Overhead press']);
});

test('smoke: a complete walk through every onboarding step finishes, marks the profile onboarded, and is then editable from Settings', () => {
  const sandbox = createSandbox(KNOWN_IDS);
  boot(sandbox);
  fireClick(sandbox, 'obstart'); // step 1
  setVal(sandbox, 'ob-h-cm', '175');
  fireClick(sandbox, 'obnext'); // 2
  fireClick(sandbox, 'obexperience', { id: 'intermediate' });
  fireClick(sandbox, 'obnext'); // 3
  fireClick(sandbox, 'obgoalprimary', { id: 'muscle_gain' });
  fireClick(sandbox, 'obnext'); // 4
  fireClick(sandbox, 'obactivity', { id: 'moderate' });
  fireClick(sandbox, 'obfreq', { n: '3' });
  fireClick(sandbox, 'obnext'); // 5
  fireClick(sandbox, 'obdays', { n: '4' });
  fireClick(sandbox, 'obschedtype', { v: 'fixed' });
  fireClick(sandbox, 'obweekday', { wd: '1' });
  fireClick(sandbox, 'obduration', { n: '60' });
  fireClick(sandbox, 'obnext'); // 6
  fireClick(sandbox, 'obaccess', { v: 'gym' });
  fireClick(sandbox, 'obsplit', { id: 'ppl' });
  fireClick(sandbox, 'obnext'); // 7
  setVal(sandbox, 'ob-limitations', 'Bad left knee');
  fireClick(sandbox, 'obnext'); // 8 - review
  let html = sheetHTML(sandbox);
  assert.ok(html.includes('Review'));
  assert.ok(html.includes('Muscle gain'));
  assert.ok(html.includes('Push / Pull / Legs'));

  fireClick(sandbox, 'obfinish');
  const saved = JSON.parse(sandbox.localStorage.getItem('vshape-tracker-v1'));
  const fp = saved.profile.fitness;
  assert.equal(fp.onboarded, true);
  assert.equal(fp.heightCm, 175);
  assert.equal(fp.experience, 'intermediate');
  assert.equal(fp.primaryGoal, 'muscle_gain');
  assert.equal(fp.activityLevel, 'moderate');
  assert.equal(fp.currentTrainingFrequency, 3);
  assert.equal(fp.workoutPrefs.daysPerWeek, 4);
  assert.deepEqual(fp.workoutPrefs.availableDays, [1]);
  assert.equal(fp.workoutPrefs.sessionDuration, 60);
  assert.equal(fp.workoutPrefs.equipmentAccess, 'gym');
  assert.equal(fp.workoutPrefs.preferredSplit, 'ppl');
  assert.equal(fp.workoutPrefs.limitations, 'Bad left knee');
  assert.equal(sheetHTML(sandbox), '', 'the onboarding sheet must close itself once finished');

  // Re-opening from Settings must start at step 1 (no welcome screen) and offer "Save & close".
  fireClick(sandbox, 'settings');
  assert.ok(sheetHTML(sandbox).includes('Profile set up'));
  fireClick(sandbox, 'obedit');
  html = sheetHTML(sandbox);
  assert.ok(html.includes('Step 1 of 8'));
  assert.equal(attrValue(html, 'ob-h-cm'), '175', 'the editor must pre-fill already-answered fields');
});

test('smoke: a pre-Phase-3A install (no fitness key at all) migrates to full fitness-profile defaults without touching existing workout/nutrition data', () => {
  const sandbox = createSandbox(KNOWN_IDS);
  const seeded = {
    schema: 3,
    profile: { targets: { kcal: 2200, protein: 170, steps: 10000, water: 2500 }, weights: { '2026-01-01': 71 }, customFoods: [] },
    days: {
      '2026-01-01': {
        date: '2026-01-01', food: [{ id: 'e1', foodId: 'egg', qty: 2 }], steps: 5000, stepsSource: 'manual', water: 500,
        sessions: [{ id: 's1', day: 'push', label: null, startedAt: 1000, finishedAt: 5000, status: 'finished', pausedAt: null, pausedMs: 0, lastAppliedSeq: 0, log: { 'incline-db': [{ w: 20, r: 8 }] }, rest: null }],
        quarantine: { sets: [], food: [] },
      },
    },
  };
  sandbox.localStorage.setItem('vshape-tracker-v1', JSON.stringify(seeded));
  assert.doesNotThrow(() => boot(sandbox));

  const saved = JSON.parse(sandbox.localStorage.getItem('vshape-tracker-v1'));
  assert.ok(saved.profile.fitness, 'expected a fitness profile to be backfilled');
  assert.equal(saved.profile.fitness.onboarded, false);
  assert.equal(saved.profile.fitness.dob, null, 'never a fabricated value');
  assert.deepEqual(saved.profile.fitness.workoutPrefs.equipment, []);
  // Pre-existing data must be completely untouched by the migration.
  assert.equal(saved.profile.weights['2026-01-01'], 71);
  assert.equal(saved.profile.targets.kcal, 2200);
  assert.equal(saved.days['2026-01-01'].food.length, 1);
  assert.equal(saved.days['2026-01-01'].sessions[0].log['incline-db'][0].w, 20);

  const sheet = sheetHTML(sandbox);
  assert.ok(sheet.includes('Your fitness profile'), 'onboarding must offer to run for an upgraded install that never had a fitness profile');
});

test('smoke: onboarding progress and answers survive an app restart (resumes at the saved step, not from scratch)', () => {
  const sandbox1 = createSandbox(KNOWN_IDS);
  boot(sandbox1);
  fireClick(sandbox1, 'obstart');
  setVal(sandbox1, 'ob-h-cm', '170');
  fireClick(sandbox1, 'obnext'); // -> step 2
  fireClick(sandbox1, 'obgender', { id: 'female' });
  const raw = sandbox1.localStorage.getItem('vshape-tracker-v1');
  const saved1 = JSON.parse(raw);
  assert.equal(saved1.profile.fitness.onboardingStep, 2);
  assert.equal(saved1.profile.fitness.onboarded, false);

  // A brand-new sandbox simulates a real app restart: fresh JS context, same persisted storage.
  const sandbox2 = createSandbox(KNOWN_IDS);
  sandbox2.localStorage.setItem('vshape-tracker-v1', raw);
  boot(sandbox2);
  const html = sheetHTML(sandbox2);
  assert.ok(html.includes('Step 2 of 8'), 'must resume at the step it was left on, not restart from the welcome screen');
  const saved2 = JSON.parse(sandbox2.localStorage.getItem('vshape-tracker-v1'));
  assert.equal(saved2.profile.fitness.heightCm, 170, 'an already-answered field must not be lost across the restart');
  assert.equal(saved2.profile.fitness.gender, 'female');
});

test('smoke: a backup export includes the fitness profile alongside the rest of the data', () => {
  const sandbox = createSandbox(KNOWN_IDS);
  boot(sandbox);
  fireClick(sandbox, 'obstart');
  setVal(sandbox, 'ob-h-cm', '190');
  fireClick(sandbox, 'obnext');

  let capturedBlobText = null;
  sandbox.Blob = function Blob(parts) { capturedBlobText = parts[0]; };
  fireClick(sandbox, 'exportdata');
  assert.ok(capturedBlobText, 'expected exportdata to build a backup blob');
  const backup = JSON.parse(capturedBlobText);
  assert.equal(backup.app, 'vshape-tracker');
  assert.equal(backup.profile.fitness.heightCm, 190, 'the exported backup must include the fitness profile, not just targets/weights');
});

// The restore path itself (VShapeCore.migrateBlob + the profile.fitness merge app.js runs
// right after it) is exercised directly here, the same way a real restore reconstructs
// S.profile from a parsed backup file - env.js's fake DOM elements do not implement
// addEventListener, so the real #backupIn file-picker change handler cannot be driven from
// a test and is intentionally not exercised here (true of every file-input flow in this
// harness, not just this one).
test('smoke: restoring a backup rebuilds a full fitness profile (migrateBlob + the same merge loadLocal runs) without fabricating any value', () => {
  const VShapeCore = require('../core.js');
  const backupProfile = { targets: { kcal: 2200, protein: 170, steps: 10000, water: 2500 }, weights: {}, customFoods: [], fitness: { onboarded: true, dob: '1990-01-01', heightCm: 190 } };
  const out = VShapeCore.migrateBlob({ schema: VShapeCore.SCHEMA_VERSION, profile: backupProfile, days: {} });
  const fitness = VShapeCore.mergeFitnessProfile(out.profile.fitness);
  assert.equal(fitness.onboarded, true);
  assert.equal(fitness.heightCm, 190);
  assert.equal(fitness.dob, '1990-01-01');
  assert.equal(fitness.currentWeightKg, null, 'a field the backup never answered must stay null, never a fabricated value');
  assert.deepEqual(fitness.workoutPrefs, VShapeCore.defaultWorkoutPrefs(), 'a backup predating workoutPrefs still gets the full default shape');
});

/* ---------- workout generator wizard (Phase 3B) ---------- */
// Settings always renders straight from the live S.plans/S.activePlanId (app.js is one big
// IIFE, so S itself is not reachable from a test - see every other plan-builder test in this
// file), so re-opening it is used here as a side-effect-free way to read plan count/activeness
// without needing a prior saveLocal() to have run.
function planRows(sandbox) {
  fireClick(sandbox, 'settings');
  const html = sheetHTML(sandbox);
  return Array.from(html.matchAll(/data-act="planactivate" data-id="([^"]+)">(&#9679;|&#9675;)/g))
    .map((m) => ({ id: m[1], active: m[2] === '&#9679;' }));
}
test('smoke: the generate wizard produces a preview and saving it adds a new, inactive plan without touching the existing active one', () => {
  const sandbox = createSandbox(KNOWN_IDS);
  boot(sandbox);
  const before = planRows(sandbox);
  const activeBefore = before.find((r) => r.active).id;

  fireClick(sandbox, 'genstart');
  let html = sheetHTML(sandbox);
  assert.ok(html.includes('Generate a workout plan'), 'expected the generate wizard to open');

  fireClick(sandbox, 'gendays', { n: '3' });
  fireClick(sandbox, 'genequip', { id: 'barbell' });
  fireClick(sandbox, 'genequip', { id: 'dumbbells' });
  fireClick(sandbox, 'gengenerate');
  html = sheetHTML(sandbox);
  assert.ok(html.includes('Plan preview'), 'expected generating to open a preview sheet');
  assert.ok(html.includes('With 2-3 days a week'), 'expected a plain-language explanation of the chosen split');

  fireClick(sandbox, 'gensave');
  const after = planRows(sandbox);
  assert.equal(after.length, before.length + 1, 'expected exactly one new plan to be added');
  assert.ok(after.find((r) => r.id === activeBefore && r.active), 'saving a generated plan must never auto-activate it or touch the previously active plan');
  const newRow = after.find((r) => !before.some((b) => b.id === r.id));
  assert.ok(newRow && !newRow.active, 'the newly generated plan must be saved inactive');

  const saved = JSON.parse(sandbox.localStorage.getItem('vshape-tracker-v1'));
  const newPlan = saved.plans.find((p) => p.id === newRow.id);
  assert.ok(newPlan.templates.length > 0, 'expected the saved plan to carry real templates');
  assert.ok(newPlan.templates[0].ex.length > 0, 'expected the saved plan templates to carry real exercises');
});

test('smoke: regenerating replaces only the in-memory preview and never writes a plan until explicitly saved', () => {
  const sandbox = createSandbox(KNOWN_IDS);
  boot(sandbox);
  const countBefore = planRows(sandbox).length;

  fireClick(sandbox, 'genstart');
  fireClick(sandbox, 'gendays', { n: '4' });
  fireClick(sandbox, 'gengenerate');
  assert.ok(sheetHTML(sandbox).includes('Plan preview'));

  fireClick(sandbox, 'genregenerate');
  assert.ok(sheetHTML(sandbox).includes('Plan preview'), 'expected regenerate to redraw another preview');

  fireClick(sandbox, 'closesheet');
  assert.equal(planRows(sandbox).length, countBefore, 'discarding (never tapping Save) must never create a plan');
});

test('smoke: choosing a fully custom split explains itself instead of generating or crashing', () => {
  const sandbox = createSandbox(KNOWN_IDS);
  boot(sandbox);
  fireClick(sandbox, 'genstart');
  fireClick(sandbox, 'gensplit', { id: 'custom' });
  assert.doesNotThrow(() => fireClick(sandbox, 'gengenerate'));
  assert.ok(sheetHTML(sandbox).includes('Generate a workout plan'), 'expected to stay on the wizard, not crash into a broken preview');
  assert.ok(sandbox.document.querySelector('#toast').textContent.toLowerCase().includes('own split'), 'expected a toast explaining why nothing was generated');
});

test('smoke: a backup round-trip preserves the generated exercise library (custom exercises and favorite/avoid flags)', () => {
  const sandbox = createSandbox(KNOWN_IDS);
  boot(sandbox);
  fireClick(sandbox, 'libopen');
  fireClick(sandbox, 'libfav', { id: 'bb-bench-press' });

  let capturedBlobText = null;
  sandbox.Blob = function Blob(parts) { capturedBlobText = parts[0]; };
  fireClick(sandbox, 'exportdata');
  const backup = JSON.parse(capturedBlobText);
  assert.deepEqual(backup.library.flags['bb-bench-press'], { favorite: true, avoid: false });

  const VShapeCore = require('../core.js');
  const out = VShapeCore.migrateBlob({ schema: VShapeCore.SCHEMA_VERSION, profile: backup.profile, days: backup.days, plans: backup.plans, activePlanId: backup.activePlanId, library: backup.library });
  const restoredLibrary = VShapeCore.mergeLibrary(out.library);
  assert.deepEqual(VShapeCore.libraryFlags(restoredLibrary, 'bb-bench-press'), { favorite: true, avoid: false });
});

/* ---------- backup restore ordering/safety (regressions) ---------- */
const CUSTOM_PLAN = { id: 'p-custom', name: 'Backup custom plan', flexible: true, schedule: { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] }, templates: [{ id: 't-fb', name: 'Full body', tag: '', cue: '', ex: [] }] };
function minimalBackup(extra) {
  return Object.assign({ app: 'vshape-tracker', v: 3, schema: 3, profile: { targets: { kcal: 2350, protein: 160, steps: 20000, water: 3000 }, weights: {}, customFoods: [] }, days: {}, photos: {}, plans: [CUSTOM_PLAN], activePlanId: 'p-custom' }, extra);
}
test('smoke: restoring keeps a safety copy of what was on the device before it was replaced', async () => {
  const sandbox = createSandbox(KNOWN_IDS);
  boot(sandbox);
  fireClick(sandbox, 'stepadd', { n: '1000' }); // make the pre-restore state distinctive
  const liveBefore = sandbox.localStorage.getItem('vshape-tracker-v1');
  pickBackupFile(sandbox, minimalBackup());
  await tick();
  fireClick(sandbox, 'doimport');
  await tick(80);
  const copies = await readSafetyCopies(sandbox);
  assert.ok(copies.some((c) => c.raw === liveBefore), 'expected the pre-restore data to be kept as a safety copy');
});
test('smoke: a backup from a newer schema is refused up front and changes nothing (including photos)', async () => {
  const sandbox = createSandbox(KNOWN_IDS);
  boot(sandbox);
  fireClick(sandbox, 'stepadd', { n: '1000' });
  const liveBefore = sandbox.localStorage.getItem('vshape-tracker-v1');
  const photo = { date: '2026-01-01', img: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' };
  pickBackupFile(sandbox, minimalBackup({ v: 99, schema: 99, photos: { '2026-01-01': photo } }));
  await tick();
  fireClick(sandbox, 'doimport');
  await tick(80);
  assert.equal(sandbox.localStorage.getItem('vshape-tracker-v1'), liveBefore, 'live data must be untouched');
  assert.ok(sandbox.document.querySelector('#toast').textContent.includes('newer app version'));
  // The old code wrote the backup's photos into IndexedDB (and deleted the existing ones) before
  // it noticed the backup was unusable, so a refused restore still changed the photo store.
  assert.equal((await readPhotoStore(sandbox)).length, 0, 'a refused restore must not have written any photos');
  assert.equal((await readSafetyCopies(sandbox)).length, 0, 'a refused restore must not have done any of the restore work');
});
test('smoke: restoring a well-formed backup still keeps its custom workout plans (plans/activePlanId survive the file-picker handler)', async () => {
  const sandbox = createSandbox(KNOWN_IDS);
  boot(sandbox); // fresh install: only the seeded default plan exists
  pickBackupFile(sandbox, minimalBackup());
  await tick();
  assert.ok(sheetHTML(sandbox).includes('Restore backup') || sheetHTML(sandbox).toLowerCase().includes('restore'), 'expected the restore confirmation sheet to open');
  fireClick(sandbox, 'doimport');
  await tick(80);
  const saved = JSON.parse(sandbox.localStorage.getItem('vshape-tracker-v1'));
  assert.equal(saved.plans.length, 1, "the restored data must contain the backup's plans, not a reseeded default");
  assert.equal(saved.plans[0].name, 'Backup custom plan');
  assert.equal(saved.activePlanId, 'p-custom');
});

/* ---------- gym counter follows the active plan (regression: was hardcoded "/ 5") ---------- */
function seedPlanOnly(sandbox, plan) {
  sandbox.localStorage.setItem('vshape-tracker-v1', JSON.stringify({
    schema: 3, profile: { targets: { kcal: 2350, protein: 160, steps: 20000, water: 3000 }, weights: {}, customFoods: [] },
    days: {}, plans: [plan], activePlanId: plan.id,
  }));
}
test('smoke: the Today gym counter uses the active plan\'s training days, not a hardcoded 5', () => {
  const sandbox = createSandbox(KNOWN_IDS);
  const plan = JSON.parse(JSON.stringify(CUSTOM_PLAN));
  plan.flexible = false;
  plan.schedule = { 0: [], 1: ['t-fb'], 2: [], 3: ['t-fb'], 4: [], 5: ['t-fb'], 6: [] };
  seedPlanOnly(sandbox, plan);
  boot(sandbox);
  const html = sandbox.document.querySelector('#app').innerHTML;
  assert.ok(html.includes('0 / 3'), 'a 3-day plan must show a 3-session weekly target');
  assert.ok(!html.includes('0 / 5'));
});
test('smoke: a flexible plan shows the gym count without a made-up weekly target', () => {
  const sandbox = createSandbox(KNOWN_IDS);
  seedPlanOnly(sandbox, JSON.parse(JSON.stringify(CUSTOM_PLAN))); // flexible: true
  boot(sandbox);
  const html = sandbox.document.querySelector('#app').innerHTML;
  assert.ok(html.includes('Gym, 7 days'));
  assert.ok(!/\b0 \/ \d/.test(html), 'no denominator for a plan with no fixed schedule');
});
test('smoke: the default seeded plan still reads "/ 5"', () => {
  const sandbox = createSandbox(KNOWN_IDS);
  boot(sandbox);
  assert.ok(sandbox.document.querySelector('#app').innerHTML.includes('0 / 5'));
});

/* ---------- backup reminder ---------- */
function isoDaysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function seedDaysAndProfile(sandbox, days, profileExtra) {
  const out = {};
  Object.keys(days).forEach((date) => { out[date] = Object.assign({ date, food: [], steps: 0, stepsSource: null, water: 0, sessions: [], quarantine: { sets: [], food: [] }, override: null }, days[date]); });
  sandbox.localStorage.setItem('vshape-tracker-v1', JSON.stringify({
    schema: 3, profile: Object.assign({ targets: { kcal: 2350, protein: 160, steps: 20000, water: 3000 }, weights: {}, customFoods: [] }, profileExtra || {}), days: out,
  }));
}
const appHTML = (sandbox) => sandbox.document.querySelector('#app').innerHTML;

test('smoke: a week of logged data and no backup shows a back-up banner on Today', () => {
  const sandbox = createSandbox(KNOWN_IDS);
  seedDaysAndProfile(sandbox, { [isoDaysAgo(10)]: { steps: 5000 } });
  boot(sandbox);
  assert.ok(appHTML(sandbox).includes('Back up your data'), 'expected the reminder');
});
test('smoke: no back-up banner for a brand new install, or for data less than a week old', () => {
  const fresh = createSandbox(KNOWN_IDS); boot(fresh);
  assert.ok(!appHTML(fresh).includes('Back up your data'));
  const young = createSandbox(KNOWN_IDS);
  seedDaysAndProfile(young, { [isoDaysAgo(2)]: { steps: 5000 } });
  boot(young);
  assert.ok(!appHTML(young).includes('Back up your data'));
});
test('smoke: "Later" snoozes the back-up banner and the snooze is saved', () => {
  const sandbox = createSandbox(KNOWN_IDS);
  seedDaysAndProfile(sandbox, { [isoDaysAgo(10)]: { steps: 5000 } });
  boot(sandbox);
  fireClick(sandbox, 'backuplater');
  assert.ok(!appHTML(sandbox).includes('Back up your data'));
  const saved = JSON.parse(sandbox.localStorage.getItem('vshape-tracker-v1'));
  assert.ok(saved.profile.backupSnoozedUntil > Date.now(), 'the snooze must be persisted');
});
test('smoke: exporting a backup records the time, stamps it inside the file, and clears the banner', () => {
  const sandbox = createSandbox(KNOWN_IDS);
  seedDaysAndProfile(sandbox, { [isoDaysAgo(10)]: { steps: 5000 } });
  boot(sandbox);
  let blob = null;
  sandbox.URL.createObjectURL = (b) => { blob = b; return 'blob:fake'; };
  const before = Date.now();
  fireClick(sandbox, 'exportdata');
  const saved = JSON.parse(sandbox.localStorage.getItem('vshape-tracker-v1'));
  assert.ok(saved.profile.lastBackupAt >= before, 'lastBackupAt must be recorded');
  const file = JSON.parse(blob.parts[0]);
  assert.equal(file.profile.lastBackupAt, saved.profile.lastBackupAt, 'the file itself carries its own timestamp, so a restore knows how fresh it is');
  assert.ok(!appHTML(sandbox).includes('Back up your data'));
});
test('smoke: Settings shows when the last backup was made', () => {
  const sandbox = createSandbox(KNOWN_IDS);
  seedDaysAndProfile(sandbox, { [isoDaysAgo(10)]: { steps: 5000 } });
  boot(sandbox);
  fireClick(sandbox, 'settings');
  assert.ok(sheetHTML(sandbox).includes('Never backed up'));
  sandbox.URL.createObjectURL = (b) => 'blob:fake';
  fireClick(sandbox, 'exportdata');
  fireClick(sandbox, 'settings');
  assert.ok(sheetHTML(sandbox).includes('Last backup: today'), 'got: ' + (sheetHTML(sandbox).match(/Last backup[^<]*|Never backed up[^<]*/) || ['(nothing)'])[0]);
});

/* ---------- exercise alternatives (Phase 3C) ---------- */
test('smoke: a generated exercise offers a "find alternative" action that substitutes the movement without touching sets/reps/rest', () => {
  const sandbox = createSandbox(KNOWN_IDS);
  boot(sandbox);
  fireClick(sandbox, 'genstart');
  fireClick(sandbox, 'gendays', { n: '3' });
  fireClick(sandbox, 'genequip', { id: 'barbell' });
  fireClick(sandbox, 'gengenerate');
  fireClick(sandbox, 'genedit');
  let html = sheetHTML(sandbox);
  assert.ok(html.includes('Edit plan'), 'expected "Edit before saving" to save the draft and open the plan editor');
  const templateId = html.match(/data-act="templatesel" data-id="([^"]+)"/)[1];
  const planId = html.match(/data-act="templateadd" data-planid="([^"]+)"/)[1];

  fireClick(sandbox, 'templatesel', { id: templateId });
  html = sheetHTML(sandbox);
  const altMatch = html.match(/data-act="exalt" data-id="([^"]+)"/);
  assert.ok(altMatch, 'expected at least one generated exercise to expose a "find alternative" action');
  const exId = altMatch[1];
  const beforeRow = html.match(new RegExp('<b>([^<]+)</b><div class="muted small">[^<]*&middot; (\\d+) x (\\d+)&ndash;(\\d+)[^<]*&middot; rest (\\d+)s[\\s\\S]{0,120}data-act="exalt" data-id="' + exId + '"'));

  fireClick(sandbox, 'exalt', { id: exId });
  html = sheetHTML(sandbox);
  assert.ok(html.includes('Find an alternative'), 'expected the alternatives sheet to open');
  const pickMatch = html.match(/data-act="exaltpick" data-id="([^"]+)"/);
  assert.ok(pickMatch, 'expected at least one ranked alternative to be offered');

  fireClick(sandbox, 'exaltpick', { id: pickMatch[1] });
  html = sheetHTML(sandbox);
  assert.ok(html.includes('Edit workout'), 'expected substituting to return to the workout template editor');

  const saved = JSON.parse(sandbox.localStorage.getItem('vshape-tracker-v1'));
  const plan = saved.plans.find((p) => p.id === planId);
  const tpl = plan.templates.find((t) => t.id === templateId);
  const substituted = tpl.ex.find((e) => e.id === exId);
  assert.ok(substituted, 'expected the exercise id to be preserved across the substitution');
  if (beforeRow) {
    assert.equal(substituted.sets, Number(beforeRow[2]), 'substituting an alternative must preserve the prescribed sets');
    assert.equal(substituted.rest, Number(beforeRow[5]), 'substituting an alternative must preserve the prescribed rest');
  }
});

test('smoke: hand-built exercises (no library id) never show a "find alternative" action', () => {
  const sandbox = createSandbox(KNOWN_IDS);
  boot(sandbox);
  fireClick(sandbox, 'settings');
  fireClick(sandbox, 'plannew');
  let html = sheetHTML(sandbox);
  const planId = html.match(/data-act="templateadd" data-planid="([^"]+)"/)[1];
  fireClick(sandbox, 'templateadd', { planid: planId });
  fireClick(sandbox, 'exadd');
  fireClick(sandbox, 'exnewcustom');
  setVal(sandbox, 'ex-name', 'Hand Built Curl');
  setVal(sandbox, 'ex-muscle', 'Biceps');
  setVal(sandbox, 'ex-sets', '3');
  setVal(sandbox, 'ex-rest', '60');
  setVal(sandbox, 'ex-lo', '8');
  setVal(sandbox, 'ex-hi', '12');
  setVal(sandbox, 'ex-start', '10');
  setVal(sandbox, 'ex-inc', '1');
  fireClick(sandbox, 'exsave');
  html = sheetHTML(sandbox);
  assert.ok(html.includes('Hand Built Curl'));
  assert.ok(!html.includes('data-act="exalt"'), 'a hand-built exercise has no library id, so there is nothing to find an alternative from');
});

/* ---------- Agent 2 integration: nutrition engine + theming ---------- */
function exportedBackup(sandbox) {
  let capturedBlobText = null;
  sandbox.Blob = function Blob(parts) { capturedBlobText = parts[0]; };
  fireClick(sandbox, 'exportdata');
  return JSON.parse(capturedBlobText);
}
test('smoke: a fresh install migrates nutrition/appearance state on boot, and a second boot is idempotent', () => {
  const sandbox = createSandbox(KNOWN_IDS);
  assert.doesNotThrow(() => boot(sandbox));
  const backup = exportedBackup(sandbox);
  assert.equal(backup.profile.nutritionAdvanced.version, 1);
  assert.deepEqual(backup.profile.nutritionAdvanced.logs, []);
  assert.ok(backup.profile.appearance && backup.profile.appearance.mode, 'expected normalized appearance defaults');

  // A fresh install never writes to localStorage until something actually saves; force one
  // harmless save so there is a real persisted blob to re-load for the idempotency check below.
  fireClick(sandbox, 'stepadd', { n: '1000' });

  // Re-loading the exact same saved blob must not throw and must not duplicate/alter anything.
  const sandbox2 = createSandbox(KNOWN_IDS);
  sandbox2.localStorage.setItem('vshape-tracker-v1', sandbox.localStorage.getItem('vshape-tracker-v1'));
  assert.doesNotThrow(() => boot(sandbox2));
  const backup2 = exportedBackup(sandbox2);
  assert.deepEqual(backup2.profile.nutritionAdvanced, backup.profile.nutritionAdvanced);
});
test('smoke: the one-time legacy migration imports existing custom foods and daily targets into the nutrition engine', () => {
  const sandbox = createSandbox(KNOWN_IDS);
  const legacy = {
    profile: { targets: { kcal: 2400, protein: 180, steps: 20000, water: 3000 }, weights: {}, customFoods: [{ id: 'c-1', name: 'My Shake', unit: 'scoop', per: 1, def: 1, k: 150, p: 30, c: 5, f: 2 }] },
    days: {}
  };
  sandbox.localStorage.setItem('vshape-tracker-v1', JSON.stringify({ schema: 3, profile: legacy.profile, days: legacy.days }));
  assert.doesNotThrow(() => boot(sandbox));
  const backup = exportedBackup(sandbox);
  assert.ok(backup.profile.nutritionAdvanced.foods.some((f) => f.name === 'My Shake'), 'expected the legacy custom food to be imported into the nutrition engine foods list');
  assert.equal(backup.profile.nutritionAdvanced.targets.daily.k, 2400);
  assert.equal(backup.profile.nutritionAdvanced.targets.daily.p, 180);
});
test('smoke: a backup round-trip preserves nutritionAdvanced and appearance exactly', () => {
  const sandbox = createSandbox(KNOWN_IDS);
  boot(sandbox);
  const original = exportedBackup(sandbox);

  const sandbox2 = createSandbox(KNOWN_IDS);
  boot(sandbox2);
  const VShapeCore = require('../core.js');
  const out = VShapeCore.migrateBlob({ schema: VShapeCore.SCHEMA_VERSION, profile: original.profile, days: original.days, plans: original.plans, activePlanId: original.activePlanId, library: original.library });
  const VShapeNutrition = require('../nutrition-advanced.js');
  const VShapeThemes = require('../theme-manager.js');
  const restoredNutrition = VShapeNutrition.migrate(out.profile.nutritionAdvanced);
  const restoredAppearance = VShapeThemes.normalize(out.profile.appearance);
  assert.deepEqual(restoredNutrition, original.profile.nutritionAdvanced);
  assert.deepEqual(restoredAppearance, original.profile.appearance);
});
test('smoke: a corrupt nutritionAdvanced blob is never discarded or replaced with empty defaults on boot', () => {
  const sandbox = createSandbox(KNOWN_IDS);
  const garbage = { version: 1, foods: 'not-an-array' };
  sandbox.localStorage.setItem('vshape-tracker-v1', JSON.stringify({ schema: 3, profile: { targets: { kcal: 2350, protein: 160, steps: 20000, water: 3000 }, weights: {}, customFoods: [], nutritionAdvanced: garbage }, days: {} }));
  assert.doesNotThrow(() => boot(sandbox));
  fireClick(sandbox, 'tab', { tab: 'food' });
  const html = sandbox.document.querySelector('#food-root').innerHTML;
  assert.ok(html.includes('needs attention'), 'expected a recovery message instead of a crash or silently-wiped data');
  const backup = exportedBackup(sandbox);
  assert.deepEqual(backup.profile.nutritionAdvanced, garbage, 'the raw corrupt blob must be preserved untouched, never replaced with fresh defaults');
});
test('smoke: switching into and out of the Food tab mounts/unmounts the nutrition UI without throwing or touching plans/sessions', () => {
  const sandbox = createSandbox(KNOWN_IDS);
  boot(sandbox);
  const before = planRows(sandbox);
  assert.doesNotThrow(() => fireClick(sandbox, 'tab', { tab: 'food' }));
  assert.ok(sandbox.document.querySelector('#app').innerHTML.includes('food-root'));
  assert.doesNotThrow(() => fireClick(sandbox, 'tab', { tab: 'train' }));
  assert.doesNotThrow(() => fireClick(sandbox, 'tab', { tab: 'food' }));
  assert.doesNotThrow(() => fireClick(sandbox, 'tab', { tab: 'today' }));
  assert.deepEqual(planRows(sandbox), before);
});
test('smoke: the legacy dashboard totals() never produces NaN from a nutrition log with an explicit null nutrient', () => {
  const sandbox = createSandbox(KNOWN_IDS);
  const today = new Date().toISOString().slice(0, 10);
  const days = {};
  days[today] = { date: today, food: [{ id: 'x1', meal: 'Lunch', name: 'Mystery bar', qty: 1, unit: 'each', k: null, p: 10, c: null, f: 2 }], steps: 0, stepsSource: null, water: 0, sessions: [], quarantine: { sets: [], food: [] }, override: null };
  sandbox.localStorage.setItem('vshape-tracker-v1', JSON.stringify({ schema: 3, profile: { targets: { kcal: 2350, protein: 160, steps: 20000, water: 3000 }, weights: {}, customFoods: [] }, days: days }));
  assert.doesNotThrow(() => boot(sandbox));
  const html = sandbox.document.querySelector('#app').innerHTML;
  assert.ok(!/NaN/.test(html), 'a null nutrient must never surface as NaN on the Today dashboard');
});
test('smoke: the lifetime theme watcher applies a resolved appearance attribute to <html> on boot', () => {
  const sandbox = createSandbox(KNOWN_IDS);
  boot(sandbox);
  assert.ok(['default', 'dark', 'light'].includes(sandbox.document.documentElement.dataset.vshapeTheme), 'expected the theme watcher to set data-vshape-theme on boot');
});

/* ---------- plate calculator (Phase 3D) ---------- */
test('smoke: a weighted exercise shows a plate calculator trigger that opens a working calculator with a graphic and a result', () => {
  const sandbox = createSandbox(KNOWN_IDS);
  seedActiveSession(sandbox);
  boot(sandbox);
  fireClick(sandbox, 'tab', { tab: 'train' });
  let html = sandbox.document.querySelector('#app').innerHTML;
  assert.ok(html.includes('data-act="platecalc" data-ex="incline-db"'), 'expected a plate calculator trigger next to a weighted exercise');

  fireClick(sandbox, 'platecalc', { ex: 'incline-db' });
  html = sheetHTML(sandbox);
  assert.ok(html.includes('Plate calculator'));
  assert.ok(html.includes('<svg'), 'expected a graphical barbell diagram for the default barbell equipment type');
  assert.ok(html.includes('Total:'), 'expected a computed result');
});
test('smoke: applying a plate calculation writes a draft weight for the next pending set without creating or touching a logged set', () => {
  const sandbox = createSandbox(KNOWN_IDS);
  seedActiveSession(sandbox);
  boot(sandbox);
  fireClick(sandbox, 'tab', { tab: 'train' });
  fireClick(sandbox, 'platecalc', { ex: 'incline-db' });
  fireClick(sandbox, 'pcequip', { id: 'dumbbell' });
  fireClick(sandbox, 'pcapply');

  const html = sandbox.document.querySelector('#app').innerHTML;
  const draftVal = attrValue(html, 'w-incline-db0');
  assert.ok(draftVal && Number(draftVal) > 0, 'expected the next pending set\'s weight input to show the applied draft value');

  const saved = JSON.parse(sandbox.localStorage.getItem('vshape-tracker-v1'));
  const session = saved.days['2026-01-01'].sessions[0];
  assert.deepEqual(session.log, {}, 'applying a plate calculation must only stage a draft, never create a logged set');
});
test('smoke: bodyweight and assisted exercises never show the plate calculator trigger', () => {
  const sandbox = createSandbox(KNOWN_IDS);
  seedActiveSession(sandbox, { exSnapshot: [{ id: 'pullup', name: 'Pull-up', sets: 2, lo: 4, hi: 10, rest: 120, inc: 2.5, start: 0, muscle: 'Back', bw: true, assisted: true }] });
  boot(sandbox);
  fireClick(sandbox, 'tab', { tab: 'train' });
  const html = sandbox.document.querySelector('#app').innerHTML;
  assert.ok(!html.includes('data-act="platecalc"'), 'a bodyweight/assisted exercise has no plate math to offer');
});
test('smoke: plate-inventory and bar settings persist across a reload', () => {
  const sandbox = createSandbox(KNOWN_IDS);
  boot(sandbox);
  fireClick(sandbox, 'platesettingsopen');
  setVal(sandbox, 'pcs-plate-w', '25');
  setVal(sandbox, 'pcs-plate-n', '4');
  fireClick(sandbox, 'pcaddplate');
  setVal(sandbox, 'pcs-barweight', '15');
  setVal(sandbox, 'pcs-collar', '5');
  fireClick(sandbox, 'pcsavebar');

  const saved = JSON.parse(sandbox.localStorage.getItem('vshape-tracker-v1'));
  assert.ok(saved.profile.plateCalc.plates.some((p) => p.weight === 25 && p.count === 4));
  assert.equal(saved.profile.plateCalc.bar.weight, 15);
  assert.equal(saved.profile.plateCalc.bar.collarWeight, 5);

  const sandbox2 = createSandbox(KNOWN_IDS);
  sandbox2.localStorage.setItem('vshape-tracker-v1', JSON.stringify(saved));
  boot(sandbox2);
  fireClick(sandbox2, 'platesettingsopen');
  const html = sheetHTML(sandbox2);
  assert.ok(html.includes('25 kg') && html.includes('&times; 4'));
  assert.ok(attrValue(html, 'pcs-barweight') === '15' || html.includes('value="15"'));
});
