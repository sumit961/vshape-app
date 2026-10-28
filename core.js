/* V-Shape core: pure logic, no DOM, no globals beyond what is passed in.
   Loaded as a plain script in the browser (attaches window.VShapeCore) and
   required as a CommonJS module under Node for tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VShapeCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SCHEMA_VERSION = 3;

  /* ---------- small helpers ---------- */
  function isFiniteNumber(n) { return typeof n === 'number' && isFinite(n); }
  function isWholeNumber(n) { return isFiniteNumber(n) && Math.round(n) === n; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function isoDay(t) { var d = new Date(t); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function roundStep(x, s) { return Math.round(Math.round(x / s) * s * 100) / 100; }
  function r1(n) { return Math.round(n * 10) / 10; }

  var _idCounter = 0;
  function genId(now) {
    _idCounter = (_idCounter + 1) % 1e6;
    return 's' + Math.max(0, now | 0).toString(36) + '-' + _idCounter.toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  }

  /* ---------- validation ---------- */
  function validateSet(ex, set) {
    if (!set || typeof set !== 'object') return { ok: false, reason: 'missing' };
    if (!isFiniteNumber(set.w)) return { ok: false, reason: 'weight-not-finite' };
    if (!isFiniteNumber(set.r) || !isWholeNumber(set.r)) return { ok: false, reason: 'reps-not-whole' };
    if (set.r <= 0) return { ok: false, reason: 'reps-not-positive' };
    if (set.w < 0 && !(ex && ex.assisted)) return { ok: false, reason: 'negative-weight-not-allowed' };
    return { ok: true };
  }

  function sanitizeBodyWeightKg(v) {
    var n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : v;
    if (!isFiniteNumber(n)) return null;
    if (n <= 30 || n >= 250) return null;
    return r1(n);
  }

  function sanitizeStepCount(v) {
    // Strip thousands separators (comma, any whitespace incl. NBSP, straight/curly apostrophe)
    // first: parseInt('12,345') is 12, which used to be saved silently.
    var n = typeof v === 'string' ? parseInt(v.replace(/[,\s'’]/g, ''), 10) : v;
    if (!isFiniteNumber(n) || n < 0 || n > 100000) return null;
    return Math.round(n);
  }

  function sanitizeMacroEntry(e) {
    if (!e || typeof e !== 'object') return null;
    var k = Number(e.k), p = Number(e.p), c = Number(e.c), f = Number(e.f);
    if (![k, p, c, f].every(isFiniteNumber)) return null;
    if (k < 0 || p < 0 || c < 0 || f < 0) return null;
    var out = {}; for (var key in e) out[key] = e[key];
    out.k = k; out.p = p; out.c = c; out.f = f;
    return out;
  }

  var PHOTO_URI_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;
  function isValidPhotoDataUri(s) {
    return typeof s === 'string' && s.length > 0 && s.length < 400000 && PHOTO_URI_RE.test(s);
  }

  /* ---------- fitness profile (Phase 3A: personal profile & onboarding) ---------- */
  var CM_PER_INCH = 2.54, KG_PER_LB = 0.45359237;
  function sanitizeHeightCm(v) {
    var n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : v;
    if (!isFiniteNumber(n)) return null;
    if (n <= 50 || n >= 272) return null; // shorter than any living adult / taller than the tallest ever recorded
    return r1(n);
  }
  function feetInchesToCm(ft, inch) {
    var f = Number(ft) || 0, i = Number(inch) || 0;
    if (!isFiniteNumber(f) || !isFiniteNumber(i)) return null;
    return r1((f * 12 + i) * CM_PER_INCH);
  }
  // Inches are rounded to the nearest whole inch for display; a rounded total
  // of 12 carries into an extra foot instead of showing "5'12"".
  function cmToFeetInches(cm) {
    if (!isFiniteNumber(cm) || cm <= 0) return { ft: 0, inch: 0 };
    var totalInches = Math.round(cm / CM_PER_INCH);
    var ft = Math.floor(totalInches / 12), inch = totalInches % 12;
    return { ft: ft, inch: inch };
  }
  function kgToLb(kg) { return isFiniteNumber(kg) ? r1(kg / KG_PER_LB) : null; }
  function lbToKg(lb) { return isFiniteNumber(lb) ? r1(lb * KG_PER_LB) : null; }
  // Accepts a 'YYYY-MM-DD' date-of-birth string (as produced by <input type=date>).
  // Rejects malformed strings, calendar-invalid dates (e.g. 2024-02-30, which
  // Date would otherwise silently roll into March), future dates, and ages
  // outside a plausible human lifespan. Returns the normalized string or null.
  function sanitizeDob(v, now) {
    if (typeof v !== 'string') return null;
    var m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    var dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    now = isFiniteNumber(now) ? now : Date.now();
    if (dt.getTime() > now) return null;
    var age = ageFromDob(v, now);
    if (age == null || age > 120) return null;
    return v;
  }
  // Whole years between a 'YYYY-MM-DD' dob and `now`, or null if dob is missing/malformed.
  function ageFromDob(dob, now) {
    if (typeof dob !== 'string') return null;
    var m = dob.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    now = isFiniteNumber(now) ? now : Date.now();
    var n = new Date(now), y = +m[1], mo = +m[2], d = +m[3];
    var age = n.getFullYear() - y;
    if (n.getMonth() + 1 < mo || (n.getMonth() + 1 === mo && n.getDate() < d)) age--;
    return age < 0 ? null : age;
  }
  function defaultWorkoutPrefs() {
    return {
      daysPerWeek: null, scheduleType: null, availableDays: [], sessionDuration: null,
      equipmentAccess: null, equipment: [], customEquipment: [], preferredSplit: null,
      priorityMuscles: [], preferredExercises: [], avoidExercises: [], limitations: null
    };
  }
  // The whole personal-profile/onboarding shape, additive to the existing profile
  // (targets/weights/baseline/...). Every field defaults to null/empty - never a
  // guessed real-world value - so a skipped question is indistinguishable from
  // "not asked yet" and nothing fabricated ever gets displayed as the user's own data.
  function defaultFitnessProfile() {
    return {
      onboarded: false, onboardingStep: 0,
      units: { weight: 'kg', height: 'cm' },
      dob: null, heightCm: null, currentWeightKg: null, targetWeightKg: null,
      gender: null, experience: null,
      primaryGoal: null, secondaryGoals: [], customGoals: [],
      activityLevel: null, currentTrainingFrequency: null,
      workoutPrefs: defaultWorkoutPrefs()
    };
  }
  // Fills in any missing/partial fields (an old install with no `fitness` key at
  // all, a hand-edited or partially-restored backup, a future field this version
  // does not know about yet) against defaultFitnessProfile(), one level deep -
  // the same shallow per-field merge convention loadLocal() already uses for
  // profile.targets. Never discards an existing answered field.
  function mergeFitnessProfile(existing) {
    var d = defaultFitnessProfile();
    var out = Object.assign({}, d, existing || {});
    out.units = Object.assign({}, d.units, (existing && existing.units) || {});
    out.workoutPrefs = Object.assign({}, d.workoutPrefs, (existing && existing.workoutPrefs) || {});
    if (!Array.isArray(out.secondaryGoals)) out.secondaryGoals = [];
    if (!Array.isArray(out.customGoals)) out.customGoals = [];
    return out;
  }

  /* ---------- exercise library (Phase 3C) ---------- */
  function slugify(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''); }

  // Canonical muscle-group/equipment id lists, kept here (not only in app.js) so the library and
  // generator - pure, DOM-free, tested under Node - never need app.js to filter or label. Same
  // label strings and same slug() as app.js's own MUSCLE_GROUPS/EQUIPMENT constants, so a
  // profile's `priorityMuscles`/`equipment` ids (chosen in the Phase 3A onboarding UI) line up
  // with these with no translation step.
  var MUSCLE_LABELS = ['Chest', 'Back', 'Shoulders', 'Biceps', 'Triceps', 'Forearms', 'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Abs / core', 'Full body'];
  var MUSCLE_GROUPS = MUSCLE_LABELS.map(function (l) { return { id: slugify(l), label: l }; });
  var EQUIPMENT_LABELS = ['Barbell', 'Dumbbells', 'Kettlebells', 'Cable machine', 'Resistance bands', 'Pull-up bar', 'Bench', 'Squat rack', 'Smith machine', 'Leg press machine', 'Lat pulldown machine', 'Rowing machine', 'Treadmill', 'Stationary bike', 'Suspension trainer (TRX)', 'Medicine ball', 'Bodyweight only'];
  var EQUIPMENT_LIST = EQUIPMENT_LABELS.map(function (l) { return { id: slugify(l), label: l }; });
  var WEEK_ORDER_CORE = [1, 2, 3, 4, 5, 6, 0];
  function labelForMuscle(id) { var m = MUSCLE_GROUPS.filter(function (x) { return x.id === id; })[0]; return m ? m.label : id; }

  // Builtin seed catalogue. `equipment:'bodyweight'` is a sentinel meaning "needs nothing" -
  // always usable regardless of the user's equipment picks - and is intentionally NOT one of the
  // EQUIPMENT_LIST ids above (those are things a user selects as owned/available; bodyweight never
  // needs selecting). Every other `equipment` value must appear in workoutPrefs.equipment to be
  // offered. Never edit an entry's fields after ship - add a new id instead - since a generated
  // template exercise copies these fields once, by value (see generateWorkoutPlan), and never
  // re-reads the catalogue again, so a later edit here could never retroactively change history
  // but could still change what a *future* generation produces in a way that is hard to reason
  // about; a new id keeps old and new behaviour both inspectable.
  function E(id, name, primaryMuscle, secondaryMuscles, movementPattern, equipment, difficulty, sets, lo, hi, rest, inc, loadType, o) {
    return Object.assign({
      id: id, name: name, primaryMuscle: primaryMuscle, secondaryMuscles: secondaryMuscles || [],
      movementPattern: movementPattern, equipment: equipment, difficulty: difficulty,
      defaultSets: sets, defaultLo: lo, defaultHi: hi, defaultRest: rest, defaultInc: inc,
      loadType: loadType, unilateral: false, timed: false, assistedCapable: false, notes: '', custom: false
    }, o || {});
  }
  var BUILTIN_EXERCISES = [
    E('bb-bench-press', 'Barbell Bench Press', 'chest', ['triceps', 'shoulders'], 'push', 'barbell', 'intermediate', 3, 5, 8, 120, 2.5, 'barbell'),
    E('incline-db-press', 'Incline Dumbbell Press', 'chest', ['shoulders', 'triceps'], 'push', 'dumbbells', 'beginner', 3, 8, 12, 90, 1, 'dumbbell'),
    E('push-up', 'Push-up', 'chest', ['triceps', 'shoulders'], 'push', 'bodyweight', 'beginner', 3, 8, 15, 60, 0, 'bodyweight'),
    E('cable-chest-fly', 'Cable Chest Fly', 'chest', ['shoulders'], 'isolation', 'cable-machine', 'beginner', 3, 10, 15, 60, 1, 'cable'),
    E('machine-chest-press', 'Machine Chest Press', 'chest', ['triceps'], 'push', 'smith-machine', 'beginner', 3, 8, 12, 75, 2.5, 'machine'),
    E('pull-up', 'Pull-up', 'back', ['biceps'], 'pull', 'pull-up-bar', 'advanced', 3, 4, 10, 120, 0, 'bodyweight', { assistedCapable: true }),
    E('lat-pulldown', 'Lat Pulldown', 'back', ['biceps'], 'pull', 'lat-pulldown-machine', 'beginner', 3, 8, 12, 90, 2.5, 'machine'),
    E('bb-row', 'Barbell Row', 'back', ['biceps', 'shoulders'], 'pull', 'barbell', 'intermediate', 3, 6, 10, 90, 2.5, 'barbell'),
    E('db-row', 'Single-arm Dumbbell Row', 'back', ['biceps'], 'pull', 'dumbbells', 'beginner', 3, 8, 12, 75, 1, 'dumbbell', { unilateral: true }),
    E('seated-cable-row', 'Seated Cable Row', 'back', ['biceps'], 'pull', 'cable-machine', 'beginner', 3, 8, 12, 75, 2.5, 'cable'),
    E('superman', 'Superman', 'back', ['glutes'], 'isolation', 'bodyweight', 'beginner', 3, 10, 15, 45, 0, 'bodyweight'),
    E('deadlift', 'Barbell Deadlift', 'back', ['hamstrings', 'glutes'], 'hinge', 'barbell', 'advanced', 3, 3, 6, 150, 2.5, 'barbell'),
    E('bb-overhead-press', 'Barbell Overhead Press', 'shoulders', ['triceps'], 'push', 'barbell', 'intermediate', 3, 5, 8, 120, 2.5, 'barbell'),
    E('db-shoulder-press', 'Dumbbell Shoulder Press', 'shoulders', ['triceps'], 'push', 'dumbbells', 'beginner', 3, 8, 12, 90, 1, 'dumbbell'),
    E('pike-pushup', 'Pike Push-up', 'shoulders', ['triceps'], 'push', 'bodyweight', 'intermediate', 3, 6, 12, 60, 0, 'bodyweight'),
    E('lateral-raise', 'Dumbbell Lateral Raise', 'shoulders', [], 'isolation', 'dumbbells', 'beginner', 3, 12, 15, 60, 0.5, 'dumbbell'),
    E('face-pull', 'Cable Face Pull', 'shoulders', ['back'], 'isolation', 'cable-machine', 'beginner', 3, 12, 15, 60, 1, 'cable'),
    E('machine-shoulder-press', 'Machine Shoulder Press', 'shoulders', ['triceps'], 'push', 'smith-machine', 'beginner', 3, 8, 12, 75, 2.5, 'machine'),
    E('bb-curl', 'Barbell Curl', 'biceps', ['forearms'], 'isolation', 'barbell', 'beginner', 3, 8, 12, 60, 1, 'barbell'),
    E('db-curl', 'Dumbbell Curl', 'biceps', ['forearms'], 'isolation', 'dumbbells', 'beginner', 3, 8, 12, 60, 0.5, 'dumbbell'),
    E('cable-curl', 'Cable Curl', 'biceps', ['forearms'], 'isolation', 'cable-machine', 'beginner', 3, 10, 15, 60, 1, 'cable'),
    E('hammer-curl', 'Hammer Curl', 'biceps', ['forearms'], 'isolation', 'dumbbells', 'beginner', 3, 8, 12, 60, 0.5, 'dumbbell'),
    E('triceps-pushdown', 'Triceps Pushdown', 'triceps', [], 'isolation', 'cable-machine', 'beginner', 3, 10, 15, 60, 1, 'cable'),
    E('skull-crusher', 'Skull Crusher', 'triceps', [], 'isolation', 'barbell', 'intermediate', 3, 8, 12, 60, 1, 'barbell'),
    E('db-overhead-extension', 'Dumbbell Overhead Extension', 'triceps', [], 'isolation', 'dumbbells', 'beginner', 3, 10, 15, 60, 0.5, 'dumbbell'),
    E('dips', 'Dips', 'triceps', ['chest', 'shoulders'], 'push', 'bodyweight', 'advanced', 3, 6, 12, 90, 0, 'bodyweight', { assistedCapable: true }),
    E('wrist-curl', 'Dumbbell Wrist Curl', 'forearms', [], 'isolation', 'dumbbells', 'beginner', 3, 12, 20, 45, 0.5, 'dumbbell'),
    E('farmers-carry', 'Farmer\'s Carry', 'forearms', ['back', 'quads'], 'carry', 'kettlebells', 'intermediate', 3, 20, 40, 90, 2.5, 'kettlebell', { timed: true }),
    E('bb-back-squat', 'Barbell Back Squat', 'quads', ['glutes', 'hamstrings'], 'squat', 'barbell', 'intermediate', 3, 5, 8, 150, 2.5, 'barbell'),
    E('leg-press', 'Leg Press', 'quads', ['glutes'], 'squat', 'leg-press-machine', 'beginner', 3, 8, 12, 120, 5, 'machine'),
    E('db-lunge', 'Dumbbell Lunge', 'quads', ['glutes', 'hamstrings'], 'lunge', 'dumbbells', 'beginner', 3, 8, 12, 90, 1, 'dumbbell', { unilateral: true }),
    E('bodyweight-squat', 'Bodyweight Squat', 'quads', ['glutes'], 'squat', 'bodyweight', 'beginner', 3, 12, 20, 60, 0, 'bodyweight'),
    E('leg-extension', 'Leg Extension', 'quads', [], 'isolation', 'leg-press-machine', 'beginner', 3, 10, 15, 75, 2.5, 'machine'),
    E('romanian-deadlift', 'Romanian Deadlift', 'hamstrings', ['glutes', 'back'], 'hinge', 'barbell', 'intermediate', 3, 6, 10, 120, 2.5, 'barbell'),
    E('leg-curl', 'Leg Curl', 'hamstrings', [], 'isolation', 'leg-press-machine', 'beginner', 3, 10, 15, 75, 2.5, 'machine'),
    E('kettlebell-swing', 'Kettlebell Swing', 'hamstrings', ['glutes', 'back'], 'hinge', 'kettlebells', 'intermediate', 3, 12, 20, 75, 2, 'kettlebell'),
    E('single-leg-glute-bridge', 'Single-leg Glute Bridge', 'hamstrings', ['glutes'], 'hinge', 'bodyweight', 'intermediate', 3, 10, 15, 45, 0, 'bodyweight', { unilateral: true }),
    E('hip-thrust', 'Barbell Hip Thrust', 'glutes', ['hamstrings'], 'hinge', 'barbell', 'beginner', 3, 8, 12, 90, 2.5, 'barbell'),
    E('glute-bridge', 'Glute Bridge', 'glutes', ['hamstrings'], 'hinge', 'bodyweight', 'beginner', 3, 12, 20, 60, 0, 'bodyweight'),
    E('cable-kickback', 'Cable Glute Kickback', 'glutes', [], 'isolation', 'cable-machine', 'beginner', 3, 12, 15, 60, 1, 'cable', { unilateral: true }),
    E('standing-calf-raise', 'Standing Calf Raise', 'calves', [], 'isolation', 'smith-machine', 'beginner', 3, 12, 20, 60, 2.5, 'machine'),
    E('db-calf-raise', 'Dumbbell Calf Raise', 'calves', [], 'isolation', 'dumbbells', 'beginner', 3, 12, 20, 45, 1, 'dumbbell'),
    E('bodyweight-calf-raise', 'Bodyweight Calf Raise', 'calves', [], 'isolation', 'bodyweight', 'beginner', 3, 15, 25, 30, 0, 'bodyweight'),
    E('plank', 'Plank', 'abs-core', ['shoulders'], 'core', 'bodyweight', 'beginner', 3, 20, 60, 45, 0, 'bodyweight', { timed: true }),
    E('cable-crunch', 'Cable Crunch', 'abs-core', [], 'core', 'cable-machine', 'beginner', 3, 12, 15, 60, 1, 'cable'),
    E('hanging-leg-raise', 'Hanging Leg Raise', 'abs-core', ['forearms'], 'core', 'pull-up-bar', 'advanced', 3, 8, 15, 60, 0, 'bodyweight'),
    E('russian-twist', 'Russian Twist', 'abs-core', [], 'core', 'bodyweight', 'beginner', 3, 16, 24, 45, 0, 'bodyweight'),
    E('burpee', 'Burpee', 'full-body', ['quads', 'chest'], 'core', 'bodyweight', 'intermediate', 3, 8, 15, 60, 0, 'bodyweight'),
    E('thruster', 'Barbell Thruster', 'full-body', ['quads', 'shoulders'], 'squat', 'barbell', 'advanced', 3, 6, 10, 90, 2.5, 'barbell')
  ];

  function defaultLibrary() { return { custom: [], flags: {} }; }
  // Additive merge, same convention as mergeFitnessProfile: fills in anything missing from an
  // old/partial/hand-edited blob against the defaults, never discards an existing custom
  // exercise or flag. A flag entry for an id that no longer resolves (a deleted custom exercise)
  // is harmless dead weight, not an error, and is left alone rather than pruned.
  function mergeLibrary(existing) {
    var d = defaultLibrary();
    var out = Object.assign({}, d, existing || {});
    if (!Array.isArray(out.custom)) out.custom = [];
    out.flags = Object.assign({}, (existing && existing.flags) || {});
    return out;
  }
  function allLibraryExercises(library) {
    return BUILTIN_EXERCISES.concat((library && library.custom) || []);
  }
  function findLibraryExercise(library, id) {
    return allLibraryExercises(library).filter(function (e) { return e.id === id; })[0] || null;
  }
  function libraryFlags(library, id) {
    return (library && library.flags && library.flags[id]) || { favorite: false, avoid: false };
  }
  function setLibraryFlag(library, id, key, value) {
    if (!library.flags) library.flags = {};
    var cur = Object.assign({ favorite: false, avoid: false }, library.flags[id] || {});
    cur[key] = !!value;
    library.flags[id] = cur;
    return cur;
  }
  function addCustomExercise(library, def, now) {
    var ex = Object.assign({}, def, { id: 'custom-' + slugify(def.name || 'exercise') + '-' + genId(now), custom: true });
    if (!Array.isArray(library.custom)) library.custom = [];
    library.custom.push(ex);
    return ex;
  }
  // Edits an existing custom entry in place - the id and custom:true are never overwritten by
  // the patch, so an edit can never turn a custom exercise into something masquerading as
  // another entry. Builtins are immutable by design (see BUILTIN_EXERCISES comment) and are not
  // reachable here. Never touches any template exercise that previously copied this entry's
  // fields by value - those snapshots (and any completed session's exSnapshot) stay exactly as
  // they were, per the same historical-data guarantee as the rest of the library.
  function updateCustomExercise(library, id, patch) {
    var idx = ((library && library.custom) || []).findIndex(function (e) { return e.id === id; });
    if (idx < 0) return null;
    library.custom[idx] = Object.assign({}, library.custom[idx], patch, { id: id, custom: true });
    return library.custom[idx];
  }
  function removeCustomExercise(library, id) {
    var idx = ((library && library.custom) || []).findIndex(function (e) { return e.id === id; });
    if (idx < 0) return false;
    library.custom.splice(idx, 1);
    return true;
  }

  // Whether a library entry can be trained right now: bodyweight entries always can (no
  // equipment needed); anything else needs that exact equipment id in the user's own list.
  function equipmentAvailable(entry, equipmentIds) {
    if (!entry) return false;
    if (entry.equipment === 'bodyweight') return true;
    return (equipmentIds || []).indexOf(entry.equipment) >= 0;
  }
  var EXPERIENCE_RANK = { beginner: 1, intermediate: 2, advanced: 3 };
  function experienceAllows(entry, experience) {
    var userRank = EXPERIENCE_RANK[experience] || 1;
    var exRank = EXPERIENCE_RANK[entry.difficulty] || 1;
    return exRank <= userRank + 1; // a beginner may still be offered one step up, never two
  }
  function nameAvoided(name, avoidNames) {
    var n = (name || '').toLowerCase();
    return (avoidNames || []).some(function (a) { return (a || '').toLowerCase() === n; });
  }

  // Ranked, explained substitutes for one exercise: same primary muscle first (falling back to
  // the same movement pattern), filtered to equipment the user actually has and exercises not
  // flagged/listed as avoided, then ordered by experience fit. Pure/read-only - callers decide
  // whether and how to apply a substitution via the existing substituteExerciseInTemplate.
  function findAlternatives(library, exerciseId, workoutPrefs, experience) {
    var target = findLibraryExercise(library, exerciseId);
    if (!target) return [];
    var equipmentIds = (workoutPrefs && workoutPrefs.equipment) || [];
    var avoidNames = (workoutPrefs && workoutPrefs.avoidExercises) || [];
    var preferredNames = (workoutPrefs && workoutPrefs.preferredExercises) || [];
    return allLibraryExercises(library)
      .filter(function (e) { return e.id !== target.id; })
      .filter(function (e) { return e.primaryMuscle === target.primaryMuscle || e.movementPattern === target.movementPattern; })
      .filter(function (e) { return equipmentAvailable(e, equipmentIds); })
      .filter(function (e) { return !nameAvoided(e.name, avoidNames) && !libraryFlags(library, e.id).avoid; })
      .map(function (e) {
        var reasons = [];
        reasons.push(e.primaryMuscle === target.primaryMuscle ? 'Trains the same muscle group' : 'Similar movement pattern');
        reasons.push('uses equipment you have');
        if (!experienceAllows(e, experience)) reasons.push('is more advanced than your current level');
        if (nameAvoided(e.name, preferredNames) || libraryFlags(library, e.id).favorite) reasons.push('one of your preferred exercises');
        return { entry: e, reason: reasons.join(', ') };
      })
      .sort(function (a, b) {
        var sameMuscleA = a.entry.primaryMuscle === target.primaryMuscle ? 0 : 1;
        var sameMuscleB = b.entry.primaryMuscle === target.primaryMuscle ? 0 : 1;
        if (sameMuscleA !== sameMuscleB) return sameMuscleA - sameMuscleB;
        var expA = experienceAllows(a.entry, experience) ? 0 : 1;
        var expB = experienceAllows(b.entry, experience) ? 0 : 1;
        if (expA !== expB) return expA - expB;
        return a.entry.name.localeCompare(b.entry.name);
      });
  }

  /* ---------- workout generator (Phase 3B) ---------- */
  // days x experience -> split, with a plain-language reason (requirement: explain why a split
  // was chosen). Only used when the profile's preferredSplit is unset/'auto'.
  var AUTO_SPLIT_TABLE = [
    { maxDays: 3, split: 'full_body', reason: 'With 2-3 days a week, training the whole body each session gives every muscle group more frequent, consistent stimulus than splitting it up.' },
    { maxDays: 4, split: 'upper_lower', reason: 'With 4 days a week, alternating upper and lower body lets you train each twice while still recovering between sessions.' },
    { maxDays: 7, split: 'ppl', reason: 'With 5 or more days a week, a push/pull/legs rotation spreads enough volume across the week without retraining the same muscles on consecutive days.' }
  ];
  function pickAutoSplit(daysPerWeek) {
    var row = AUTO_SPLIT_TABLE.filter(function (r) { return daysPerWeek <= r.maxDays; })[0] || AUTO_SPLIT_TABLE[AUTO_SPLIT_TABLE.length - 1];
    return { split: row.split, reason: row.reason };
  }
  var SPLIT_DAY_TYPES = {
    full_body: ['full_body'], upper_lower: ['upper', 'lower'], ppl: ['push', 'pull', 'legs'],
    body_part: ['chest_back', 'shoulders_arms', 'legs_core'], custom: []
  };
  var DAY_TYPE_MUSCLES = {
    full_body: ['chest', 'back', 'quads', 'shoulders', 'hamstrings', 'abs-core'],
    upper: ['chest', 'back', 'shoulders', 'biceps', 'triceps'],
    lower: ['quads', 'hamstrings', 'glutes', 'calves', 'abs-core'],
    push: ['chest', 'shoulders', 'triceps'], pull: ['back', 'biceps', 'forearms'], legs: ['quads', 'hamstrings', 'glutes', 'calves'],
    chest_back: ['chest', 'back'], shoulders_arms: ['shoulders', 'biceps', 'triceps'], legs_core: ['quads', 'hamstrings', 'glutes', 'abs-core']
  };
  var DAY_TYPE_LABELS = {
    full_body: 'Full body', upper: 'Upper body', lower: 'Lower body', push: 'Push', pull: 'Pull', legs: 'Legs',
    chest_back: 'Chest & Back', shoulders_arms: 'Shoulders & Arms', legs_core: 'Legs & Core'
  };
  function dayTypesForDays(split, daysPerWeek) {
    var rotation = SPLIT_DAY_TYPES[split] || SPLIT_DAY_TYPES.full_body;
    var out = [];
    for (var i = 0; i < daysPerWeek; i++) out.push(rotation[i % rotation.length]);
    return out;
  }
  // Rep range / rest / set-count emphasis by primary goal - a simple, explainable starting point
  // the user can edit freely, not a claim of research-backed numbers.
  var GOAL_EMPHASIS = {
    strength: { lo: 3, hi: 6, restFactor: 1.3 }, muscle_gain: { lo: 6, hi: 12, restFactor: 1 },
    body_recomp: { lo: 8, hi: 12, restFactor: 0.9 }, fat_loss: { lo: 10, hi: 15, restFactor: 0.7 },
    endurance: { lo: 12, hi: 20, restFactor: 0.6 }, athletic_performance: { lo: 5, hi: 10, restFactor: 1 },
    conditioning: { lo: 10, hi: 15, restFactor: 0.6 }, general_fitness: { lo: 8, hi: 12, restFactor: 1 },
    mobility: { lo: 10, hi: 15, restFactor: 0.8, setsDelta: -1 }, weight_maintenance: { lo: 8, hi: 12, restFactor: 1 }
  };
  var EXPERIENCE_SETS_DELTA = { beginner: -1, intermediate: 0, advanced: 1 };
  // ~ minutes per exercise including its rest - a rough planning heuristic for how many
  // exercises fit a session, not a promise.
  var MINUTES_PER_EXERCISE = 11;
  function exercisesPerDay(sessionDuration) {
    var n = Math.round((sessionDuration || 45) / MINUTES_PER_EXERCISE);
    return Math.max(3, Math.min(8, n));
  }

  // Most recent logged working weight for an exercise name, from real session history across
  // every day/session the same way weeklyVolumeByMuscle reads it - never fabricated. `sessions`
  // is a flat array (caller flattens S.days the same way weeklyVolumeByMuscle's caller already does).
  function lastLoggedWeightForName(sessions, name) {
    var n = (name || '').toLowerCase(), best = null;
    (sessions || []).forEach(function (session) {
      var exMap = {}; (session.exSnapshot || []).forEach(function (e) { exMap[e.id] = e; });
      Object.keys((session && session.log) || {}).forEach(function (exId) {
        var ex = exMap[exId];
        if (!ex || (ex.name || '').toLowerCase() !== n) return;
        (session.log[exId] || []).forEach(function (s) {
          if (!s || !(s.w > 0)) return;
          var ts = session.finishedAt || session.startedAt || 0;
          if (!best || ts >= best.ts) best = { ts: ts, w: s.w };
        });
      });
    });
    return best ? best.w : null;
  }

  // Deterministic, rules-based weekly plan generator. Pure: reads `fitnessProfile`/`library`/
  // `sessions` and returns a PLAIN PREVIEW object - it never writes to S.plans/S.days itself.
  // Saving (via newPlan/createPlan/addTemplateToPlan/addExerciseToTemplate/setWeekdayTemplates,
  // the exact builders the manual plan editor already uses) is the caller's job, so a saved
  // generated plan is byte-for-byte the same shape as a hand-built one and can be edited with the
  // same code. `weekdayAssignment` is parallel to `days` (weekday number or null, NOT a
  // plan.schedule map) because the real template ids only exist once the caller creates them.
  function generateWorkoutPlan(fitnessProfile, library, sessions, now) {
    now = isFiniteNumber(now) ? now : Date.now();
    var wp = (fitnessProfile && fitnessProfile.workoutPrefs) || defaultWorkoutPrefs();
    var experience = (fitnessProfile && fitnessProfile.experience) || 'beginner';
    var goal = (fitnessProfile && fitnessProfile.primaryGoal) || 'general_fitness';
    var daysPerWeek = wp.daysPerWeek || 3;
    var sessionDuration = wp.sessionDuration || 45;
    var equipmentIds = wp.equipment || [];
    var avoidNames = wp.avoidExercises || [];
    var preferredNames = wp.preferredExercises || [];
    var priorityMuscles = wp.priorityMuscles || [];

    if (wp.preferredSplit === 'custom') {
      return { ok: false, reason: 'custom-split', message: 'You chose to build your own split - use the plan editor to create it exercise by exercise.' };
    }
    var splitPick = (wp.preferredSplit && wp.preferredSplit !== 'auto' && SPLIT_DAY_TYPES[wp.preferredSplit])
      ? { split: wp.preferredSplit, reason: 'Using your preferred split.' }
      : pickAutoSplit(daysPerWeek);
    var dayTypes = dayTypesForDays(splitPick.split, daysPerWeek);
    var emphasis = GOAL_EMPHASIS[goal] || GOAL_EMPHASIS.general_fitness;
    var setsDelta = (emphasis.setsDelta || 0) + (EXPERIENCE_SETS_DELTA[experience] || 0);
    var perDayCount = exercisesPerDay(sessionDuration);
    var allEx = allLibraryExercises(library);

    function usable(entry) {
      return equipmentAvailable(entry, equipmentIds) && experienceAllows(entry, experience) &&
        !nameAvoided(entry.name, avoidNames) && !libraryFlags(library, entry.id).avoid;
    }
    function rank(entry) {
      var score = 0;
      if (priorityMuscles.indexOf(entry.primaryMuscle) >= 0) score -= 3;
      if (nameAvoided(entry.name, preferredNames) || libraryFlags(library, entry.id).favorite) score -= 2;
      if (entry.difficulty === experience) score -= 1;
      return score;
    }

    var typeCounts = {}; dayTypes.forEach(function (t) { typeCounts[t] = (typeCounts[t] || 0) + 1; });
    var typeSeen = {};
    var days = dayTypes.map(function (dayType) {
      var muscles = DAY_TYPE_MUSCLES[dayType] || [];
      var picks = [], usedIds = {};
      muscles.forEach(function (m) {
        var slots = priorityMuscles.indexOf(m) >= 0 ? 2 : 1;
        var candidates = allEx.filter(function (e) { return e.primaryMuscle === m && usable(e) && !usedIds[e.id]; })
          .sort(function (a, b) { return (rank(a) - rank(b)) || a.id.localeCompare(b.id); });
        candidates.slice(0, slots).forEach(function (e) { picks.push(e); usedIds[e.id] = true; });
      });
      if (picks.length > perDayCount) picks = picks.slice(0, Math.max(perDayCount, muscles.length));
      var exercises = picks.map(function (entry) {
        var rest = Math.max(30, Math.round(entry.defaultRest * emphasis.restFactor / 5) * 5);
        var sets = Math.max(2, entry.defaultSets + setsDelta);
        var startW = entry.loadType === 'bodyweight' ? null : lastLoggedWeightForName(sessions, entry.name);
        return {
          id: genId(now) + '-gex-' + Math.random().toString(36).slice(2, 6),
          libraryId: entry.id, name: entry.name, sets: sets, lo: emphasis.lo, hi: emphasis.hi, rest: rest, inc: entry.defaultInc,
          start: startW, muscle: labelForMuscle(entry.primaryMuscle), cue: '',
          bw: entry.loadType === 'bodyweight', assisted: false, timed: !!entry.timed
        };
      });
      var label = DAY_TYPE_LABELS[dayType] || dayType, name = label;
      if (typeCounts[dayType] > 1) {
        var n = typeSeen[dayType] = (typeSeen[dayType] || 0) + 1;
        name = label + ' ' + String.fromCharCode(64 + n);
      }
      return { name: name, tag: label, dayType: dayType, exercises: exercises };
    });

    var flexible = true, weekdayAssignment = days.map(function () { return null; });
    if (wp.scheduleType === 'fixed' && (wp.availableDays || []).length) {
      flexible = false;
      var orderedDays = WEEK_ORDER_CORE.filter(function (wd) { return wp.availableDays.indexOf(wd) >= 0; });
      weekdayAssignment = days.map(function (_, i) { return orderedDays.length ? orderedDays[i % orderedDays.length] : null; });
    }

    return { ok: true, split: splitPick.split, splitReason: splitPick.reason, daysPerWeek: daysPerWeek, flexible: flexible, weekdayAssignment: weekdayAssignment, days: days };
  }

  /* ---------- plate calculator (Phase 3D) ---------- */
  // All arithmetic here runs in integer grams internally - kg weights carry 1-2 decimal places
  // (1.25kg plates are standard) and repeated float addition/subtraction across several plates
  // drifts (0.1+0.2 !== 0.3 in IEEE754). Every public function still takes/returns plain kg.
  function kgToGrams(kg) { return Math.round((kg || 0) * 1000); }
  function gramsToKg(g) { return Math.round(g) / 1000; }
  function kgDiff(a, b) { return gramsToKg(kgToGrams(a) - kgToGrams(b)); }

  // Greedy, descending-weight fill of a target from a limited multiset of denominations -
  // deliberately not an exhaustive subset-sum search: this is how a lifter actually loads a bar
  // or a pin-loaded stack in practice (always the biggest piece that still fits), it is fast and
  // deterministic, and it naturally respects a limited inventory. `inventory` is
  // [{weight(kg), count}]; `maxPerDenom(count)` caps how many of a denomination this call may
  // use - floor(count/2) for one side of a barbell (both sides need a matching plate), or
  // `count` itself for an unpaired stack. Never returns more than the target (never overshoots).
  function greedyLoad(targetKg, inventory, maxPerDenom) {
    var targetG = Math.max(0, kgToGrams(targetKg));
    var denoms = (inventory || [])
      .filter(function (p) { return p && p.weight > 0 && p.count > 0; })
      .map(function (p) { return { weightG: kgToGrams(p.weight), weightKg: p.weight, max: maxPerDenom(p.count) }; })
      .filter(function (d) { return d.weightG > 0 && d.max > 0; })
      .sort(function (a, b) { return b.weightG - a.weightG; });
    var remaining = targetG, used = [];
    denoms.forEach(function (d) {
      var n = Math.min(d.max, Math.floor(remaining / d.weightG));
      if (n > 0) { used.push({ weight: d.weightKg, n: n }); remaining -= n * d.weightG; }
    });
    return { used: used, reachedKg: gramsToKg(targetG - remaining) };
  }
  // Symmetric barbell loading: total = bar + collars + 2x(one side). Searches only the per-side
  // half-target, using at most floor(count/2) of each plate denomination (a plate is only usable
  // if there is a matching one for the other side), then doubles it back out.
  function findBarbellLoading(targetTotalKg, bar, plates) {
    var barWeight = (bar && bar.weight) || 0, collar = (bar && bar.collarWeight) || 0;
    var perSideTarget = Math.max(0, (targetTotalKg - barWeight - collar) / 2);
    var r = greedyLoad(perSideTarget, plates, function (count) { return Math.floor(count / 2); });
    var achievableTotal = gramsToKg(kgToGrams(barWeight) + kgToGrams(collar) + 2 * kgToGrams(r.reachedKg));
    return { achievableTotal: achievableTotal, perSide: r.used, diffFromTarget: kgDiff(achievableTotal, targetTotalKg) };
  }
  // Unpaired pin-loaded stack (machine/cable/Smith): total = base + sum(selected increments).
  // `stack.increments` are the user's own labelled/configured values - never an invented number.
  function findStackLoading(targetTotalKg, stack) {
    var base = (stack && stack.baseWeight) || 0;
    var delta = Math.max(0, targetTotalKg - base);
    var r = greedyLoad(delta, (stack && stack.increments) || [], function (count) { return count; });
    var achievableTotal = gramsToKg(kgToGrams(base) + kgToGrams(r.reachedKg));
    return { achievableTotal: achievableTotal, selected: r.used, diffFromTarget: kgDiff(achievableTotal, targetTotalKg) };
  }
  // Fixed-increment equipment (most dumbbell racks): nearest reachable multiple of `step` within
  // [min, max]. Never implies a weight finer than the rack's real increments.
  function nearestStepped(targetKg, step, min, max) {
    step = step > 0 ? step : 1;
    min = isFiniteNumber(min) ? min : 0;
    max = isFiniteNumber(max) ? max : Infinity;
    var n = Math.round((targetKg - min) / step);
    var achievable = Math.max(min, Math.min(max, min + n * step));
    achievable = gramsToKg(kgToGrams(achievable));
    return { achievableTotal: achievable, diffFromTarget: kgDiff(achievable, targetKg) };
  }
  // Irregular fixed sizes (kettlebells): nearest value in the user's own entered list - never a
  // guessed size they don't actually have.
  function nearestFromList(targetKg, values) {
    var list = (values || []).filter(isFiniteNumber);
    if (!list.length) return { achievableTotal: null, diffFromTarget: null };
    var best = list[0];
    list.forEach(function (v) { if (Math.abs(v - targetKg) < Math.abs(best - targetKg)) best = v; });
    return { achievableTotal: best, diffFromTarget: kgDiff(best, targetKg) };
  }

  function defaultPlateCalc() {
    return {
      unit: 'kg',
      bar: { weight: 20, collarWeight: 2.5 },
      barPresets: [
        { id: 'oly20', label: "Men's Olympic 20kg", weight: 20 },
        { id: 'oly15', label: "Women's Olympic 15kg", weight: 15 },
        { id: 'tech10', label: 'Technique bar 10kg', weight: 10 }
      ],
      plates: [
        { weight: 25, count: 2 }, { weight: 20, count: 2 }, { weight: 15, count: 2 }, { weight: 10, count: 2 },
        { weight: 5, count: 2 }, { weight: 2.5, count: 2 }, { weight: 1.25, count: 2 }
      ],
      dumbbellStep: 2,
      kettlebells: [8, 12, 16, 20, 24, 28, 32],
      stack: { baseWeight: 0, increments: [{ weight: 5, count: 20 }] },
      exerciseEquipment: {}
    };
  }
  // Additive merge, same convention as mergeFitnessProfile/mergeLibrary: fills in anything
  // missing from an old/partial/hand-edited blob against the defaults, never discards an
  // existing bar preset/plate row/remembered per-exercise equipment choice.
  function mergePlateCalc(existing) {
    var d = defaultPlateCalc();
    var out = Object.assign({}, d, existing || {});
    out.bar = Object.assign({}, d.bar, (existing && existing.bar) || {});
    if (!Array.isArray(out.barPresets)) out.barPresets = d.barPresets;
    if (!Array.isArray(out.plates)) out.plates = d.plates;
    if (!Array.isArray(out.kettlebells)) out.kettlebells = d.kettlebells;
    out.stack = Object.assign({}, d.stack, (existing && existing.stack) || {});
    if (!Array.isArray(out.stack.increments)) out.stack.increments = d.stack.increments;
    out.exerciseEquipment = Object.assign({}, (existing && existing.exerciseEquipment) || {});
    return out;
  }

  /* ---------- sessions ---------- */
  function newSession(day, now, label, extra) {
    now = isFiniteNumber(now) ? now : Date.now();
    var s = {
      id: genId(now), day: day || null, label: label || null,
      startedAt: now, finishedAt: null, status: 'active',
      pausedAt: null, pausedMs: 0, lastAppliedSeq: 0,
      log: {}, rest: null,
      planId: null, dayId: null, dayName: null, dayTag: null, dayCue: null, exSnapshot: []
    };
    if (extra && typeof extra === 'object') {
      if (extra.planId !== undefined) s.planId = extra.planId;
      if (extra.dayId !== undefined) s.dayId = extra.dayId;
      if (extra.dayName !== undefined) s.dayName = extra.dayName;
      if (extra.dayTag !== undefined) s.dayTag = extra.dayTag;
      if (extra.dayCue !== undefined) s.dayCue = extra.dayCue;
      if (extra.exSnapshot !== undefined) s.exSnapshot = extra.exSnapshot;
    }
    return s;
  }

  function findOpenSession(day) {
    var list = (day && day.sessions) || [];
    for (var i = list.length - 1; i >= 0; i--) {
      if (list[i].status === 'active' || list[i].status === 'paused') return list[i];
    }
    return null;
  }
  function findSessionById(day, id) {
    return ((day && day.sessions) || []).filter(function (s) { return s.id === id; })[0] || null;
  }
  function findSessionsForDay(day, dayKey) {
    return ((day && day.sessions) || []).filter(function (s) { return s.day === dayKey; });
  }
  function findOpenSessionForDay(day, dayKey) {
    var list = findSessionsForDay(day, dayKey);
    for (var i = list.length - 1; i >= 0; i--) {
      if (list[i].status === 'active' || list[i].status === 'paused') return list[i];
    }
    return null;
  }
  function findLastSessionForDay(day, dayKey) {
    var list = findSessionsForDay(day, dayKey);
    return list.length ? list[list.length - 1] : null;
  }
  // Decides what starting/continuing a workout should do, without ever reusing
  // or mutating a *finished* session: a finished session for today's Push day
  // must not silently become the target of a second Push workout later today.
  function decideSessionStart(day, dayKey, globalOpenSession) {
    var existing = findOpenSessionForDay(day, dayKey);
    if (existing) return { action: 'reuse', session: existing };
    if (globalOpenSession) return { action: 'blocked', blockingSession: globalOpenSession };
    return { action: 'create' };
  }

  function sessionElapsedMs(session, now) {
    if (!session) return 0;
    now = isFiniteNumber(now) ? now : Date.now();
    var end = session.status === 'paused' ? session.pausedAt
      : session.status === 'finished' ? session.finishedAt : now;
    if (!isFiniteNumber(end) || !isFiniteNumber(session.startedAt)) return 0;
    return Math.max(0, (end - session.startedAt) - (session.pausedMs || 0));
  }
  function pauseSession(session, now) {
    now = isFiniteNumber(now) ? now : Date.now();
    if (!session || session.status !== 'active') return session;
    session.status = 'paused'; session.pausedAt = now;
    return session;
  }
  function resumeSession(session, now) {
    now = isFiniteNumber(now) ? now : Date.now();
    if (!session || session.status !== 'paused') return session;
    session.pausedMs = (session.pausedMs || 0) + (now - session.pausedAt);
    session.pausedAt = null; session.status = 'active';
    return session;
  }
  function finishSession(session, now) {
    now = isFiniteNumber(now) ? now : Date.now();
    if (!session || session.status === 'finished') return session;
    if (session.status === 'paused') {
      session.pausedMs = (session.pausedMs || 0) + (now - session.pausedAt);
      session.pausedAt = null;
    }
    session.status = 'finished'; session.finishedAt = now; session.rest = null;
    return session;
  }

  function logSetIntoSession(session, ex, index, entry) {
    var v = validateSet(ex, entry);
    if (!v.ok) return v;
    var arr = session.log[ex.id] || (session.log[ex.id] = []);
    while (arr.length < index) arr.push(null);
    arr[index] = { w: entry.w, r: entry.r };
    return { ok: true };
  }
  function undoSetInSession(session, exId, index) {
    var arr = session.log[exId];
    if (!arr || !arr[index]) return { ok: false, reason: 'not-logged' };
    arr[index] = null;
    if (!arr.some(Boolean)) delete session.log[exId];
    return { ok: true };
  }
  function sessionSetsDone(session, programDay) {
    var log = (session && session.log) || {}, done = 0, total = 0, vol = 0;
    ((programDay && programDay.ex) || []).forEach(function (e) {
      total += e.sets;
      (log[e.id] || []).forEach(function (s) { if (s) { done++; if (!e.timed && s.w > 0) vol += s.w * s.r; } });
    });
    return { done: done, total: total, vol: vol };
  }

  /* ---------- workout plans (custom plan builder) ---------- */
  // A Plan is {id, name, flexible:boolean, schedule:{0..6:[templateId]}, templates:[Template]}.
  // A Template (e.g. "Push A", "Chest & Triceps") is {id, name, tag, cue, ex:[ExDef]} - a
  // reusable, named workout; weekday scheduling is NOT stored on the template, only in the
  // plan's `schedule` map, so the same template id can be assigned to any number of weekdays
  // (Mon/Thu full body, say) without duplicating its exercise definitions. `schedule[weekday]`
  // is always an array of template ids: [] means a rest day, a single id means that template
  // trains that weekday, and more than one id means the user must explicitly choose which one
  // when they open Train that day (never silently the first). `flexible:true` means the plan
  // has no fixed weekdays at all - every day offers the full template list to choose from.
  // ExDef is the same shape the app already used for program exercises
  // (id,name,sets,lo,hi,rest,inc,start,muscle,cue,bw,assisted,timed). Sessions snapshot a
  // template's ex array at creation time (newSession's exSnapshot), so editing or deleting a
  // plan/template later never changes how an already-started or already-finished session is
  // displayed or counted.
  function emptySchedule() { return { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] }; }
  function newPlan(name, now) { return { id: genId(now), name: name || 'New plan', flexible: false, schedule: emptySchedule(), templates: [] }; }
  function newTemplate(name, now) { return { id: genId(now) + '-t', name: name || 'New workout', tag: '', cue: '', ex: [] }; }
  function findPlan(plans, id) { return (plans || []).filter(function (p) { return p.id === id; })[0] || null; }
  function findTemplate(plan, templateId) { return ((plan && plan.templates) || []).filter(function (t) { return t.id === templateId; })[0] || null; }
  // Always returns an array (never null/undefined), even for a weekday never touched by
  // setWeekdayTemplates, so callers never need to null-check before reading .length.
  function scheduleSlot(plan, weekday) {
    return (plan && plan.schedule && plan.schedule[weekday]) || [];
  }
  // How many weekdays have at least one workout scheduled: the weekly "x / n sessions" target.
  // Two options on one weekday is still one training day. A flexible plan has no fixed weekly
  // schedule, so it has no target (0) and callers should show the bare count instead.
  function scheduledTrainingDays(plan) {
    if (!plan || plan.flexible) return 0;
    var n = 0;
    for (var wd = 0; wd < 7; wd++) if (scheduleSlot(plan, wd).length) n++;
    return n;
  }
  function setWeekdayTemplates(plan, weekday, templateIds) {
    if (!plan.schedule) plan.schedule = emptySchedule();
    // De-duplicate defensively; a UI bug or double-tap should never let the same template
    // appear twice in one weekday's options.
    var seen = {}, out = [];
    (templateIds || []).forEach(function (id) { if (id && !seen[id]) { seen[id] = true; out.push(id); } });
    plan.schedule[weekday] = out;
    return out;
  }
  // The resolved outcome of opening Train on a given weekday: 'rest' (nothing scheduled),
  // a single template id (exactly one option - never ambiguous), or {choose:[ids]} when more
  // than one template is scheduled and the app must ask instead of silently picking one.
  function resolveWeekday(plan, weekday) {
    var slot = plan && plan.flexible ? (plan.templates || []).map(function (t) { return t.id; }) : scheduleSlot(plan, weekday);
    if (!slot.length) return { kind: 'rest' };
    if (slot.length === 1) return { kind: 'template', templateId: slot[0] };
    return { kind: 'choose', options: slot.slice() };
  }
  function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

  // A date-specific override on top of whatever the recurring weekly schedule says for that
  // date: {type:'rest'} forces that one date to show/behave as a rest day regardless of what
  // is normally scheduled (covers both "Rest Today" on a scheduled workout day and the
  // explicit "Rest Today" confirmation on an already-scheduled rest day); {type:'train',
  // templateId} forces training on an otherwise-rest date with a specific chosen template
  // ("Skip Rest & Train"). It is purely a display/routing decision for ONE calendar date -
  // never a session, never a PR, and never a change to the recurring Mon..Sun schedule itself
  // (that still lives on the plan). `resolution` is whatever resolveWeekday() already
  // returned for that weekday; a null/missing override returns it untouched.
  function applyDayOverride(resolution, override) {
    if (!override) return resolution;
    if (override.type === 'rest') return { kind: 'rest' };
    if (override.type === 'train' && override.templateId) return { kind: 'template', templateId: override.templateId };
    return resolution;
  }

  function createPlan(plans, name, now) {
    var p = newPlan(name, now);
    plans.push(p);
    return p;
  }
  // Duplicating a plan keeps every exercise id unchanged (so progression history and PR
  // tracking for "the same real exercise" keep working across the copy), but gives the plan
  // itself and every template inside it a fresh id, so editing the copy can never alter the
  // original, and re-points the copied schedule at the copied templates' new ids.
  function duplicatePlan(plans, planId, newName, now) {
    var src = findPlan(plans, planId);
    if (!src) return null;
    var copy = deepClone(src);
    copy.id = genId(now) + '-dup';
    copy.name = newName || (src.name + ' (copy)');
    var idMap = {};
    copy.templates.forEach(function (t) {
      var newId = genId(now) + '-t-' + Math.random().toString(36).slice(2, 6);
      idMap[t.id] = newId; t.id = newId;
    });
    Object.keys(copy.schedule || {}).forEach(function (wd) {
      copy.schedule[wd] = (copy.schedule[wd] || []).map(function (id) { return idMap[id] || id; });
    });
    plans.push(copy);
    return copy;
  }
  // Refuses to delete the last remaining plan (the app always needs at least
  // one plan to drive the Train tab). If the deleted plan was active, the
  // caller should switch activePlanId to newActivePlanId.
  function deletePlan(plans, planId, activePlanId) {
    if (!plans || plans.length <= 1) return { ok: false, reason: 'last-plan' };
    var idx = plans.findIndex(function (p) { return p.id === planId; });
    if (idx < 0) return { ok: false, reason: 'not-found' };
    plans.splice(idx, 1);
    if (activePlanId === planId) return { ok: true, removed: true, newActivePlanId: plans[0].id };
    return { ok: true, removed: true };
  }
  function addTemplateToPlan(plan, template) { plan.templates.push(template); return template; }
  // Removing a template also strips it out of every weekday it was scheduled on, so the
  // schedule never holds a dangling reference to a template that no longer exists; any
  // weekday left with zero options simply becomes a rest day.
  function removeTemplateFromPlan(plan, templateId) {
    var idx = plan.templates.findIndex(function (t) { return t.id === templateId; });
    if (idx < 0) return false;
    plan.templates.splice(idx, 1);
    Object.keys(plan.schedule || {}).forEach(function (wd) {
      plan.schedule[wd] = (plan.schedule[wd] || []).filter(function (id) { return id !== templateId; });
    });
    return true;
  }
  function addExerciseToTemplate(template, exDef, index) {
    if (!exDef.id) exDef.id = genId(Date.now()) + '-ex';
    if (index == null || index > template.ex.length) template.ex.push(exDef);
    else template.ex.splice(index, 0, exDef);
    return exDef;
  }
  function removeExerciseFromTemplate(template, exId) {
    var idx = template.ex.findIndex(function (e) { return e.id === exId; });
    if (idx < 0) return false;
    template.ex.splice(idx, 1);
    return true;
  }
  function moveExerciseInTemplate(template, exId, delta) {
    var idx = template.ex.findIndex(function (e) { return e.id === exId; });
    if (idx < 0) return false;
    var to = idx + delta;
    if (to < 0 || to >= template.ex.length) return false;
    var tmp = template.ex[idx]; template.ex[idx] = template.ex[to]; template.ex[to] = tmp;
    return true;
  }
  function substituteExerciseInTemplate(template, exId, newExDef) {
    var idx = template.ex.findIndex(function (e) { return e.id === exId; });
    if (idx < 0) return false;
    template.ex[idx] = newExDef;
    return true;
  }
  // Upgrades a plan from the previous shape (days:[{id,name,tag,cue,rest,weekdays,ex}],
  // no templates/schedule) into the current one, in place, idempotently. A plan already on
  // the current shape (has `templates`) is returned untouched. Every old day becomes a
  // template with the SAME id (critical: existing sessions' dayId/day already point at that
  // exact id - this is the same reasoning as the earlier fix that keeps the seeded default
  // plan's ids equal to the pre-plans literal program keys, applied one layer up) and its
  // weekdays become schedule entries; an old rest day never had an "Add exercise" control in
  // the UI, so it can only ever have an empty ex list and becomes an empty schedule slot
  // instead of a template - nothing is lost either way.
  function migratePlanShape(plan) {
    if (!plan || plan.templates) return plan;
    var templates = [], schedule = emptySchedule();
    (plan.days || []).forEach(function (d) {
      if (!d.rest) {
        templates.push({ id: d.id, name: d.name, tag: d.tag || '', cue: d.cue || '', ex: d.ex || [] });
        (d.weekdays || []).forEach(function (wd) { schedule[wd] = (schedule[wd] || []).concat([d.id]); });
      }
    });
    plan.templates = templates;
    plan.schedule = schedule;
    plan.flexible = !!plan.flexible;
    delete plan.days;
    return plan;
  }

  // Sums logged-set volume (kg, excluding timed/bodyweight-only sets, same
  // convention as sessionSetsDone) grouped by muscle group, using each
  // session's own exSnapshot rather than any live plan - this is what keeps
  // the analytics correct even after the plan that produced them is edited
  // or deleted.
  function weeklyVolumeByMuscle(sessions) {
    var out = {};
    (sessions || []).forEach(function (session) {
      var exMap = {};
      (session.exSnapshot || []).forEach(function (e) { exMap[e.id] = e; });
      Object.keys((session && session.log) || {}).forEach(function (exId) {
        var ex = exMap[exId];
        if (!ex || ex.timed) return;
        (session.log[exId] || []).forEach(function (s) {
          if (!s || !(s.w > 0)) return;
          var m = ex.muscle || 'Other';
          out[m] = (out[m] || 0) + s.w * s.r;
        });
      });
    });
    return out;
  }

  /* ---------- rest timer (durable deadline, stored on the session) ---------- */
  function startRest(session, ex, now) {
    now = isFiniteNumber(now) ? now : Date.now();
    if (!session) return null;
    var ms = (ex.rest || 0) * 1000;
    session.rest = { exId: ex.id, label: ex.name, startedAt: now, durationMs: ms, deadline: now + ms, paused: false, pausedRemainingMs: null, done: false };
    return session.rest;
  }
  function pauseRest(session, now) {
    now = isFiniteNumber(now) ? now : Date.now();
    var r = session && session.rest; if (!r || r.paused) return r;
    r.pausedRemainingMs = Math.max(0, r.deadline - now); r.paused = true;
    return r;
  }
  function resumeRest(session, now) {
    now = isFiniteNumber(now) ? now : Date.now();
    var r = session && session.rest; if (!r || !r.paused) return r;
    r.deadline = now + (r.pausedRemainingMs || 0); r.paused = false; r.pausedRemainingMs = null;
    return r;
  }
  function skipRest(session) { if (session) session.rest = null; }
  function restRemainingMs(session, now) {
    now = isFiniteNumber(now) ? now : Date.now();
    var r = session && session.rest; if (!r) return null;
    return r.paused ? r.pausedRemainingMs : Math.max(0, r.deadline - now);
  }

  /* ---------- action-queue reconciliation (native notification -> app state) ---------- */
  // 'logset' actions carry the exact displayed weight/reps the lifter tapped "Log Set" on
  // (exId, index, w, r). They are validated against the session's own frozen exSnapshot (never
  // a live, possibly-since-edited plan), and a set index that is already logged is skipped as
  // 'set-already-logged' - a SEPARATE check from the seq-staleness one above it, because two
  // distinct queued actions (different seq - e.g. a slow double-tap before the button
  // disabled) can both target the same set index. Without this, the second one would silently
  // overwrite an already-recorded set instead of being a no-op. A successful log also starts
  // the matching rest timer in the SAME reconciled step, so "logged but rest never started"
  // can never happen from a partially-applied action.
  function reconcileActions(session, actions, now) {
    now = isFiniteNumber(now) ? now : Date.now();
    var applied = [], skipped = [];
    var sorted = (actions || []).slice().sort(function (a, b) { return a.seq - b.seq; });
    sorted.forEach(function (a) {
      if (!session) { skipped.push({ action: a, reason: 'no-session' }); return; }
      if (!isFiniteNumber(a.seq) || a.seq <= (session.lastAppliedSeq || 0)) { skipped.push({ action: a, reason: 'stale-or-duplicate' }); return; }
      if (a.sessionId && a.sessionId !== session.id) { skipped.push({ action: a, reason: 'session-mismatch' }); return; }
      if (session.status === 'finished') { skipped.push({ action: a, reason: 'session-finished' }); return; }
      var ts = isFiniteNumber(a.ts) ? a.ts : now;
      switch (a.type) {
        case 'pause': pauseSession(session, ts); break;
        case 'resume': resumeSession(session, ts); break;
        case 'skip-rest': skipRest(session); break;
        case 'pause-rest': pauseRest(session, ts); break;
        case 'resume-rest': resumeRest(session, ts); break;
        case 'logset':
          var exMap = {};
          (session.exSnapshot || []).forEach(function (e) { exMap[e.id] = e; });
          var ex = exMap[a.exId];
          if (!ex) { skipped.push({ action: a, reason: 'unknown-exercise' }); return; }
          if (!isFiniteNumber(a.index) || a.index < 0) { skipped.push({ action: a, reason: 'bad-index' }); return; }
          if (session.log[a.exId] && session.log[a.exId][a.index]) { skipped.push({ action: a, reason: 'set-already-logged' }); return; }
          var res = logSetIntoSession(session, ex, a.index, { w: a.w, r: a.r });
          if (!res.ok) { skipped.push({ action: a, reason: 'invalid-set-' + res.reason }); return; }
          startRest(session, ex, ts);
          break;
        case 'finish': finishSession(session, ts); break;
        default: skipped.push({ action: a, reason: 'unknown-type' }); return;
      }
      session.lastAppliedSeq = a.seq;
      applied.push(a);
    });
    return { applied: applied, skipped: skipped };
  }

  function shouldShowNotification(session) {
    return !!session && (session.status === 'active' || session.status === 'paused');
  }

  /* ---------- notification state machine ---------- */
  // Derives a single display/control state for the live workout notification from the
  // session's existing, already-authoritative fields - no new state is stored, this is a pure
  // read. 'exercise_complete' means every exercise in the workout has all its sets logged
  // (ready to finish), not just the current one - that is the actionable moment the
  // notification should prompt for, distinct from 'resting' (which already covers the
  // in-between-sets pause the name might otherwise suggest).
  function notificationState(session, programDay) {
    if (!session) return 'workout_finished';
    if (session.status === 'finished') return 'workout_finished';
    if (session.status === 'paused') return 'workout_paused';
    if (session.rest) return session.rest.paused ? 'rest_paused' : 'resting';
    var sd = sessionSetsDone(session, programDay);
    if (sd.total > 0 && sd.done >= sd.total) return 'exercise_complete';
    return 'ready';
  }
  // The next not-yet-logged set, in program order: {exIndex, exId, setIndex}, or null once
  // every set in the workout is logged (exercise_complete).
  function nextPendingSet(session, programDay) {
    var list = pendingSetsList(session, programDay);
    return list.length ? list[0] : null;
  }
  // Every not-yet-logged set in the whole workout, in program order. This is what lets a
  // caller (the native notification, specifically) walk through an entire remaining workout
  // using only a session's exSnapshot plus whatever has been logged so far - it does not need
  // history or progression logic, just "what's left".
  function pendingSetsList(session, programDay) {
    var log = (session && session.log) || {};
    var ex = (programDay && programDay.ex) || [];
    var out = [];
    for (var i = 0; i < ex.length; i++) {
      var e = ex[i], logged = log[e.id] || [];
      for (var j = 0; j < e.sets; j++) {
        if (!logged[j]) out.push({ exIndex: i, exId: e.id, setIndex: j });
      }
    }
    return out;
  }

  /* ---------- progression suggestions ---------- */
  function suggestProgression(ex, hist) {
    var last = hist[hist.length - 1];
    if (!last) {
      var reps = []; for (var i = 0; i < ex.sets; i++) reps.push(ex.lo);
      return { w: ex.start, reps: reps, first: true, note: 'First time. Pick a weight you could lift for ' + (ex.lo + 2) + (ex.timed ? ' seconds' : ' clean reps') + ' with 2 to 3 reps left. The load below is only a starting guess.' };
    }
    var w0 = last.sets[0].w, same = last.sets.filter(function (s) { return s.w === w0; }), avg = same.reduce(function (a, s) { return a + s.r; }, 0) / same.length;
    var step = ex.inc || 1, reps2 = [], i2;
    var allTop = same.length >= ex.sets && same.every(function (s) { return s.r >= ex.hi; });
    if (allTop) {
      if (ex.inc > 0) {
        for (i2 = 0; i2 < ex.sets; i2++) reps2.push(ex.lo);
        return { w: roundStep(w0 + ex.inc, 0.25), reps: reps2, last: last, note: 'You hit ' + ex.hi + (ex.timed ? ' s' : '') + ' on every set. Add weight and aim for ' + ex.lo + '.', up: true };
      }
      for (i2 = 0; i2 < ex.sets; i2++) reps2.push(((same[i2] || same[same.length - 1]).r) + 1);
      return { w: w0, reps: reps2, last: last, note: 'Top of the range. Slow the lowering or add ankle weight, and keep adding reps.' };
    }
    if (avg < ex.lo && (w0 > 0 || ex.assisted)) {
      for (i2 = 0; i2 < ex.sets; i2++) reps2.push(ex.lo);
      var newW = ex.assisted ? roundStep(w0 - ex.inc, 0.25) : Math.max(0, roundStep(w0 * 0.92, Math.min(step, 2.5)));
      return { w: newW, reps: reps2, last: last, note: ex.assisted ? 'Reps fell under ' + ex.lo + ' last time. Use a little more assistance and build back up.' : 'Reps fell under ' + ex.lo + ' last time. Drop the weight a little and build back up.' };
    }
    for (i2 = 0; i2 < ex.sets; i2++) {
      var pr = (same[i2] || same[same.length - 1]).r;
      reps2.push(ex.timed ? Math.min(ex.hi, pr + 5) : Math.min(ex.hi, pr + 1));
    }
    return { w: w0, reps: reps2, last: last, note: 'Same weight. Beat last time by ' + (ex.timed ? '5 seconds' : 'one rep') + ' per set.' };
  }
  function e1rm(ex, s) { return ex.timed || (ex.bw && !s.w) ? s.r : s.w * (1 + s.r / 30); }
  // Assisted exercises log assistance as a NEGATIVE weight, where e1rm's w * (1 + r/30) is
  // meaningless (more reps at the same assistance scored as worse, and best>0 could never hold).
  // Order them by load first - less assistance (higher w) wins - with reps as the tie-break.
  // r/1000 can never outweigh a real load step: the smallest step is 0.25 kg and reps are < 250.
  function setScore(ex, s) { return ex.assisted ? s.w + s.r / 1000 : e1rm(ex, s); }
  function isPR(ex, hist, loggedSets) {
    var best = -Infinity, cur = -Infinity;
    hist.forEach(function (h) { h.sets.forEach(function (s) { best = Math.max(best, setScore(ex, s)); }); });
    (loggedSets || []).forEach(function (s) { if (s) cur = Math.max(cur, setScore(ex, s)); });
    if (best === -Infinity || cur === -Infinity) return false;
    return ex.assisted ? cur > best : (best > 0 && cur > best);
  }
  // The per-session series the Strength chart plots, and its unit. Timed exercises chart their
  // best seconds, bodyweight-only ones their best reps, assisted ones the least-assisted load in
  // kg (negative = assisted), and everything else an estimated one-rep max.
  function strengthSeries(ex, hist) {
    hist = hist || [];
    var noLoad = function (h) { return h.sets.every(function (s) { return !s.w; }); };
    var best = function (h, f) { return Math.max.apply(null, h.sets.map(f)); };
    var repsOnly = !!ex.timed || (!!ex.bw && hist.length > 0 && hist.every(noLoad));
    var points = hist.map(function (h) {
      var v;
      if (ex.timed || (ex.bw && noLoad(h))) v = best(h, function (s) { return s.r; });
      else if (ex.assisted) v = best(h, function (s) { return s.w; });
      else v = best(h, function (s) { return s.w * (1 + s.r / 30); });
      return { d: h.d, v: v };
    });
    return { unit: ex.timed ? 's' : repsOnly ? 'reps' : 'kg', points: points };
  }

  /* ---------- migration (v1 -> schema 2) ---------- */
  function migrateBlob(raw) {
    if (raw && raw.schema === SCHEMA_VERSION) {
      return { schema: SCHEMA_VERSION, profile: raw.profile || {}, days: raw.days || {}, plans: raw.plans || null, activePlanId: raw.activePlanId || null, library: raw.library || null, migrated: false };
    }
    if (raw && raw.schema && raw.schema > SCHEMA_VERSION) {
      return { locked: true, reason: 'newer-schema', schemaFound: raw.schema };
    }
    if (raw && raw.schema === 2) {
      // Already session-shaped (days[*].sessions); the only thing schema 3
      // adds is the plans concept, which simply did not exist yet. Nothing
      // about days/sessions themselves needs to change.
      return { schema: SCHEMA_VERSION, profile: raw.profile || {}, days: raw.days || {}, plans: null, activePlanId: null, library: raw.library || null, migrated: true };
    }
    var days = {}, profile = (raw && raw.profile) || {};
    Object.keys((raw && raw.days) || {}).forEach(function (date) {
      var od = raw.days[date] || {};
      var sessions = [];
      if (od.w && od.w.log && Object.keys(od.w.log).length) {
        sessions.push({
          id: genId(0) + '-' + date, day: od.w.day || null, label: null,
          startedAt: null, finishedAt: null, status: 'finished',
          pausedAt: null, pausedMs: 0, lastAppliedSeq: 0, log: od.w.log, rest: null
        });
      }
      days[date] = {
        date: date,
        food: Array.isArray(od.food) ? od.food : [],
        steps: isFiniteNumber(od.steps) ? od.steps : 0,
        stepsSource: od.steps ? 'manual' : null,
        water: isFiniteNumber(od.water) ? od.water : 0,
        active: od.active,
        rhr: od.rhr,
        sessions: sessions,
        quarantine: { sets: [], food: [] }
      };
    });
    return { schema: SCHEMA_VERSION, profile: profile, days: days, plans: null, activePlanId: null, library: raw && raw.library || null, migrated: true };
  }

  function quarantineInvalidSets(day, exlist) {
    if (!day || !day.sessions) return;
    if (!day.quarantine) day.quarantine = { sets: [], food: [] };
    day.sessions.forEach(function (session) {
      var snapshotMap = null;
      if (session.exSnapshot && session.exSnapshot.length) {
        snapshotMap = {};
        session.exSnapshot.forEach(function (e) { snapshotMap[e.id] = e; });
      }
      var lookup = snapshotMap || exlist;
      Object.keys(session.log || {}).forEach(function (exId) {
        var ex = lookup[exId], arr = session.log[exId];
        if (!arr) return;
        arr.forEach(function (s, i) {
          if (!s) return;
          var v = validateSet(ex, s);
          if (!v.ok) {
            day.quarantine.sets.push({ sessionId: session.id, exId: exId, index: i, value: s, reason: v.reason });
            arr[i] = null;
          }
        });
        if (!arr.some(Boolean)) delete session.log[exId];
      });
    });
  }

  /* ---------- backup parsing ---------- */
  function parseBackupJSON(text) {
    var obj;
    try { obj = JSON.parse(text); } catch (e) { return { ok: false, error: 'not-json' }; }
    if (!obj || typeof obj !== 'object') return { ok: false, error: 'not-an-object' };
    if (obj.app !== 'vshape-tracker') return { ok: false, error: 'wrong-app' };
    if (!obj.profile || typeof obj.profile !== 'object') return { ok: false, error: 'missing-profile' };
    if (!obj.days || typeof obj.days !== 'object') return { ok: false, error: 'missing-days' };
    return { ok: true, data: obj };
  }
  // Turns a parsed backup into the "pending restore" the Restore sheet holds until the user
  // confirms. Pure, so it is unit-tested directly. It MUST carry plans/activePlanId through:
  // the export writes them, and dropping them here silently reset a restored user's custom
  // workout plans to the seeded default. Photos that fail validation are dropped and counted.
  function prepareRestore(obj) {
    var photos = {}, dropped = 0, src = (obj && obj.photos) || {};
    Object.keys(src).forEach(function (k) {
      var p = src[k];
      if (p && isValidPhotoDataUri(p.img)) photos[k] = p; else dropped++;
    });
    return {
      schema: obj.schema,
      profile: obj.profile,
      days: obj.days,
      plans: Array.isArray(obj.plans) ? obj.plans : null,
      activePlanId: typeof obj.activePlanId === 'string' ? obj.activePlanId : null,
      photos: photos,
      dropped: dropped
    };
  }

  /* ---------- backup reminder + recent foods ---------- */
  // All data lives on the device (no backend), so a stale or missing backup is the app's biggest
  // data-loss risk. This decides whether to nudge, as a pure function so it is unit-tested:
  // never in the first week of data, then when there is no backup at all or the last one is 14+
  // days old, and not while the user has snoozed the nudge ("Later").
  var ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  function daysBetweenISO(a, b) {
    var pa = a.split('-').map(Number), pb = b.split('-').map(Number);
    return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
  }
  function dayHasContent(day) {
    if (!day || typeof day !== 'object') return false;
    return !!((day.food && day.food.length) || day.steps > 0 || day.water > 0 || (day.sessions && day.sessions.length));
  }
  function backupReminder(profile, days, todayIso, now) {
    profile = profile || {}; days = days || {};
    now = isFiniteNumber(now) ? now : Date.now();
    if (isFiniteNumber(profile.backupSnoozedUntil) && profile.backupSnoozedUntil > now) return null;
    var first = null;
    Object.keys(days).forEach(function (d) { if (ISO_DAY_RE.test(d) && dayHasContent(days[d]) && (first === null || d < first)) first = d; });
    Object.keys(profile.weights || {}).forEach(function (d) { if (ISO_DAY_RE.test(d) && (first === null || d < first)) first = d; });
    if (first === null || daysBetweenISO(first, todayIso) < 7) return null;
    if (!isFiniteNumber(profile.lastBackupAt)) return { kind: 'never', sinceDays: null };
    var since = Math.floor((now - profile.lastBackupAt) / 86400000);
    return since >= 14 ? { kind: 'stale', sinceDays: since } : null;
  }
  // Distinct foods (by name), most recently logged first, each with the quantity and unit last
  // used - feeds the "Recent" group in the Add sheet and its pre-filled amount.
  function recentFoods(days, limit) {
    var out = [], seen = {};
    limit = isFiniteNumber(limit) ? limit : 10;
    if (!days || typeof days !== 'object') return out;
    var keys = Object.keys(days).filter(function (d) { return ISO_DAY_RE.test(d); }).sort().reverse();
    for (var i = 0; i < keys.length && out.length < limit; i++) {
      var food = days[keys[i]] && days[keys[i]].food;
      if (!Array.isArray(food)) continue;
      for (var j = food.length - 1; j >= 0 && out.length < limit; j--) {
        var e = food[j];
        if (!e || typeof e.name !== 'string' || !e.name || seen[e.name]) continue;
        seen[e.name] = true;
        out.push({ name: e.name, qty: e.qty, unit: e.unit });
      }
    }
    return out;
  }

  /* ---------- Health Connect transforms (pure; native/plugin calls stay in app.js) ---------- */
  function hcEnergyToKcal(e) {
    if (!e) return 0;
    var v = Number(e.value) || 0, u = String(e.unit || '').toLowerCase();
    if (u.indexOf('kilojoule') >= 0) return v / 4.184;
    if (u === 'calories') return v / 1000;
    return v;
  }
  function hcWeightToKg(w) {
    if (!w) return null;
    var v = Number(w.value); if (!isFiniteNumber(v)) return null;
    var u = String(w.unit || '').toLowerCase();
    if (u.indexOf('kilogram') >= 0) return v;
    if (u.indexOf('gram') >= 0) return v / 1000;
    if (u.indexOf('pound') >= 0) return v * 0.45359237;
    if (u.indexOf('ounce') >= 0) return v * 0.0283495;
    return v;
  }
  function hcPermissionState(res) {
    if (!res) return 'unknown';
    if (res.hasAllPermissions === true) return 'granted';
    if (res.hasAllPermissions === false) return 'denied';
    if (Array.isArray(res.granted) && Array.isArray(res.requested)) {
      return res.requested.every(function (p) { return res.granted.indexOf(p) >= 0; }) ? 'granted' : 'denied';
    }
    return 'unknown';
  }
  function mergeBySourceMax(records, getDay, getValue) {
    var byDay = {};
    records.forEach(function (r) {
      var d = getDay(r), o = (r.metadata && r.metadata.dataOrigin) || '?';
      var v = getValue(r); if (!isFiniteNumber(v)) return;
      var x = byDay[d] || (byDay[d] = {});
      x[o] = (x[o] || 0) + v;
    });
    var out = {};
    Object.keys(byDay).forEach(function (d) {
      var best = Math.max.apply(null, Object.keys(byDay[d]).map(function (o) { return byDay[d][o]; }));
      if (best > 0) out[d] = Math.round(best);
    });
    return out;
  }
  function mergeSteps(records) {
    return mergeBySourceMax(records, function (r) { return isoDay(r.startTime); }, function (r) { return Number(r.count) || 0; });
  }
  function mergeActiveCalories(records) {
    return mergeBySourceMax(records, function (r) { return isoDay(r.startTime); }, function (r) { return hcEnergyToKcal(r.energy); });
  }
  function mergeRestingHR(records) {
    var out = {};
    records.forEach(function (r) {
      var d = isoDay(r.time || r.startTime), bpm = Number(r.beatsPerMinute);
      if (isFiniteNumber(bpm) && bpm > 0) out[d] = bpm;
    });
    return out;
  }
  function mergeWeights(records) {
    var latest = {};
    records.forEach(function (r) {
      var t = r.time || r.startTime, d = isoDay(t), kg = hcWeightToKg(r.weight);
      if (kg == null || kg <= 30 || kg >= 250) return;
      var ts = new Date(t).getTime();
      if (!latest[d] || ts > latest[d].ts) latest[d] = { ts: ts, kg: r1(kg) };
    });
    var out = {}; Object.keys(latest).forEach(function (d) { out[d] = latest[d].kg; });
    return out;
  }
  function stepsApplyPolicy(existingDay, phoneValue) {
    if (!(phoneValue > 0)) return { apply: false };
    if (!existingDay || !existingDay.steps) return { apply: true, source: 'phone' };
    if (existingDay.stepsSource === 'phone') return { apply: true, source: 'phone' };
    return { apply: false, offerPhoneValue: phoneValue };
  }
  function weightApplyPolicy(existingWeightForDay) {
    return { apply: existingWeightForDay == null };
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    genId: genId,
    isFiniteNumber: isFiniteNumber, isWholeNumber: isWholeNumber,
    validateSet: validateSet, sanitizeBodyWeightKg: sanitizeBodyWeightKg,
    sanitizeStepCount: sanitizeStepCount, sanitizeMacroEntry: sanitizeMacroEntry,
    isValidPhotoDataUri: isValidPhotoDataUri,
    sanitizeHeightCm: sanitizeHeightCm, feetInchesToCm: feetInchesToCm, cmToFeetInches: cmToFeetInches,
    kgToLb: kgToLb, lbToKg: lbToKg, sanitizeDob: sanitizeDob, ageFromDob: ageFromDob,
    defaultWorkoutPrefs: defaultWorkoutPrefs, defaultFitnessProfile: defaultFitnessProfile,
    mergeFitnessProfile: mergeFitnessProfile,
    MUSCLE_GROUPS: MUSCLE_GROUPS, EQUIPMENT_LIST: EQUIPMENT_LIST, BUILTIN_EXERCISES: BUILTIN_EXERCISES,
    defaultLibrary: defaultLibrary, mergeLibrary: mergeLibrary, allLibraryExercises: allLibraryExercises,
    findLibraryExercise: findLibraryExercise, libraryFlags: libraryFlags, setLibraryFlag: setLibraryFlag,
    addCustomExercise: addCustomExercise, updateCustomExercise: updateCustomExercise, removeCustomExercise: removeCustomExercise,
    findAlternatives: findAlternatives,
    generateWorkoutPlan: generateWorkoutPlan, lastLoggedWeightForName: lastLoggedWeightForName,
    greedyLoad: greedyLoad, findBarbellLoading: findBarbellLoading, findStackLoading: findStackLoading,
    nearestStepped: nearestStepped, nearestFromList: nearestFromList,
    defaultPlateCalc: defaultPlateCalc, mergePlateCalc: mergePlateCalc,
    newSession: newSession, findOpenSession: findOpenSession, findSessionById: findSessionById,
    findSessionsForDay: findSessionsForDay, findOpenSessionForDay: findOpenSessionForDay,
    findLastSessionForDay: findLastSessionForDay, decideSessionStart: decideSessionStart,
    sessionElapsedMs: sessionElapsedMs, pauseSession: pauseSession, resumeSession: resumeSession, finishSession: finishSession,
    logSetIntoSession: logSetIntoSession, undoSetInSession: undoSetInSession, sessionSetsDone: sessionSetsDone,
    startRest: startRest, pauseRest: pauseRest, resumeRest: resumeRest, skipRest: skipRest, restRemainingMs: restRemainingMs,
    reconcileActions: reconcileActions, shouldShowNotification: shouldShowNotification,
    notificationState: notificationState, nextPendingSet: nextPendingSet, pendingSetsList: pendingSetsList,
    newPlan: newPlan, newTemplate: newTemplate, findPlan: findPlan, findTemplate: findTemplate,
    scheduleSlot: scheduleSlot, scheduledTrainingDays: scheduledTrainingDays, setWeekdayTemplates: setWeekdayTemplates, resolveWeekday: resolveWeekday,
    applyDayOverride: applyDayOverride,
    createPlan: createPlan, duplicatePlan: duplicatePlan, deletePlan: deletePlan,
    addTemplateToPlan: addTemplateToPlan, removeTemplateFromPlan: removeTemplateFromPlan,
    addExerciseToTemplate: addExerciseToTemplate, removeExerciseFromTemplate: removeExerciseFromTemplate,
    moveExerciseInTemplate: moveExerciseInTemplate, substituteExerciseInTemplate: substituteExerciseInTemplate,
    migratePlanShape: migratePlanShape, weeklyVolumeByMuscle: weeklyVolumeByMuscle,
    suggestProgression: suggestProgression, isPR: isPR, e1rm: e1rm, strengthSeries: strengthSeries,
    migrateBlob: migrateBlob, quarantineInvalidSets: quarantineInvalidSets,
    parseBackupJSON: parseBackupJSON, prepareRestore: prepareRestore,
    backupReminder: backupReminder, recentFoods: recentFoods,
    hcEnergyToKcal: hcEnergyToKcal, hcWeightToKg: hcWeightToKg, hcPermissionState: hcPermissionState,
    mergeSteps: mergeSteps, mergeActiveCalories: mergeActiveCalories, mergeRestingHR: mergeRestingHR, mergeWeights: mergeWeights,
    stepsApplyPolicy: stepsApplyPolicy, weightApplyPolicy: weightApplyPolicy,
    isoDay: isoDay, roundStep: roundStep
  };
});
