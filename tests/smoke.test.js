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

test('smoke: fresh install boots, renders, and does not inject a fake 70kg weigh-in', () => {
  const sandbox = createSandbox(KNOWN_IDS);
  assert.doesNotThrow(() => boot(sandbox));
  const html = sandbox.document.querySelector('#app').innerHTML;
  assert.ok(html.length > 200, 'expected the Today view to render real content');
  assert.ok(!html.includes('70 kg logged'), 'a fresh install must not pre-fill a 70 kg weigh-in');
  assert.ok(html.includes('V-SHAPE'), 'expected the app header to render');
});

test('smoke: a legacy (schema-less) backup is migrated to schema 2 sessions on boot, with a safety copy kept', () => {
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
  assert.equal(saved.schema, 2);
  const day = saved.days['2026-01-01'];
  assert.equal(day.sessions.length, 1);
  assert.equal(day.sessions[0].day, 'push');
  assert.deepEqual(day.sessions[0].log['incline-db'][0], { w: 20, r: 8 });
  assert.equal(day.sessions[0].log['incline-db'][1], null);

  const backupKeys = [];
  for (let i = 0; i < sandbox.localStorage.length; i++) backupKeys.push(sandbox.localStorage.key(i));
  const safetyKey = backupKeys.find((k) => k.indexOf('pre-migration') >= 0);
  assert.ok(safetyKey, 'expected an untouched copy of the pre-migration data to be kept');
  const safetyRaw = JSON.parse(sandbox.localStorage.getItem(safetyKey));
  assert.equal(safetyRaw.days['2026-01-01'].w.log['incline-db'][0].w, 20);
});

test('smoke: data from a newer schema is locked, not flattened or discarded', () => {
  const sandbox = createSandbox(KNOWN_IDS);
  sandbox.localStorage.setItem('vshape-tracker-v1', JSON.stringify({ schema: 99, profile: {}, days: { x: { sessions: [] } } }));
  assert.doesNotThrow(() => boot(sandbox));
  // The original, un-mangled blob must still be sitting under the same key.
  const saved = JSON.parse(sandbox.localStorage.getItem('vshape-tracker-v1'));
  assert.equal(saved.schema, 99);
});
