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
  // The seeded default plan's day ids MUST equal the old literal program keys ('push'/'pull'/...) a
  // pre-plans session already has in its own `day` field - otherwise openSessionFor/lastSessionFor
  // (which match by exact day-id equality) can never find this session again, and the Train tab
  // would silently show a previously-logged day as if nothing had been logged, even though the data
  // itself is intact and still counted correctly by history()/PR/volume (which don't filter by day id).
  const pushDay = saved.plans[0].days.find((d) => d.name === 'Push A');
  assert.equal(pushDay.id, 'push', 'the seeded "Push A" day must keep the literal id a migrated session already refers to');

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
  const planId = html.match(/data-act="dayadd" data-planid="([^"]+)"/)[1];

  fireClick(sandbox, 'dayadd', { planid: planId });
  html = sheetHTML(sandbox);
  assert.ok(html.includes('Edit day'), 'expected the new day editor to open immediately after adding a day');

  // Schedule the new day on today's real weekday so curWd()/autoDay() picks it up once this plan is active.
  const todayWeekday = new Date().getDay();
  fireClick(sandbox, 'daywd', { wd: String(todayWeekday) });

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
  assert.ok(html.includes('Smoke Test Press'), 'expected the newly saved custom exercise to appear back on the day editor');
  const exIdMatch = html.match(/data-act="exedit" data-id="([^"]+)"/);
  assert.ok(exIdMatch, 'expected the saved custom exercise to have an id');
  const exId = exIdMatch[1];

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
