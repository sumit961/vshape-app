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
    var n = typeof v === 'string' ? parseInt(v, 10) : v;
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
  function isPR(ex, hist, loggedSets) {
    var best = 0, cur = 0;
    hist.forEach(function (h) { h.sets.forEach(function (s) { best = Math.max(best, e1rm(ex, s)); }); });
    (loggedSets || []).forEach(function (s) { if (s) cur = Math.max(cur, e1rm(ex, s)); });
    return best > 0 && cur > best;
  }

  /* ---------- migration (v1 -> schema 2) ---------- */
  function migrateBlob(raw) {
    if (raw && raw.schema === SCHEMA_VERSION) {
      return { schema: SCHEMA_VERSION, profile: raw.profile || {}, days: raw.days || {}, plans: raw.plans || null, activePlanId: raw.activePlanId || null, migrated: false };
    }
    if (raw && raw.schema && raw.schema > SCHEMA_VERSION) {
      return { locked: true, reason: 'newer-schema', schemaFound: raw.schema };
    }
    if (raw && raw.schema === 2) {
      // Already session-shaped (days[*].sessions); the only thing schema 3
      // adds is the plans concept, which simply did not exist yet. Nothing
      // about days/sessions themselves needs to change.
      return { schema: SCHEMA_VERSION, profile: raw.profile || {}, days: raw.days || {}, plans: null, activePlanId: null, migrated: true };
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
    return { schema: SCHEMA_VERSION, profile: profile, days: days, plans: null, activePlanId: null, migrated: true };
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
    newSession: newSession, findOpenSession: findOpenSession, findSessionById: findSessionById,
    findSessionsForDay: findSessionsForDay, findOpenSessionForDay: findOpenSessionForDay,
    findLastSessionForDay: findLastSessionForDay, decideSessionStart: decideSessionStart,
    sessionElapsedMs: sessionElapsedMs, pauseSession: pauseSession, resumeSession: resumeSession, finishSession: finishSession,
    logSetIntoSession: logSetIntoSession, undoSetInSession: undoSetInSession, sessionSetsDone: sessionSetsDone,
    startRest: startRest, pauseRest: pauseRest, resumeRest: resumeRest, skipRest: skipRest, restRemainingMs: restRemainingMs,
    reconcileActions: reconcileActions, shouldShowNotification: shouldShowNotification,
    notificationState: notificationState, nextPendingSet: nextPendingSet, pendingSetsList: pendingSetsList,
    newPlan: newPlan, newTemplate: newTemplate, findPlan: findPlan, findTemplate: findTemplate,
    scheduleSlot: scheduleSlot, setWeekdayTemplates: setWeekdayTemplates, resolveWeekday: resolveWeekday,
    applyDayOverride: applyDayOverride,
    createPlan: createPlan, duplicatePlan: duplicatePlan, deletePlan: deletePlan,
    addTemplateToPlan: addTemplateToPlan, removeTemplateFromPlan: removeTemplateFromPlan,
    addExerciseToTemplate: addExerciseToTemplate, removeExerciseFromTemplate: removeExerciseFromTemplate,
    moveExerciseInTemplate: moveExerciseInTemplate, substituteExerciseInTemplate: substituteExerciseInTemplate,
    migratePlanShape: migratePlanShape, weeklyVolumeByMuscle: weeklyVolumeByMuscle,
    suggestProgression: suggestProgression, isPR: isPR, e1rm: e1rm,
    migrateBlob: migrateBlob, quarantineInvalidSets: quarantineInvalidSets,
    parseBackupJSON: parseBackupJSON,
    hcEnergyToKcal: hcEnergyToKcal, hcWeightToKg: hcWeightToKg, hcPermissionState: hcPermissionState,
    mergeSteps: mergeSteps, mergeActiveCalories: mergeActiveCalories, mergeRestingHR: mergeRestingHR, mergeWeights: mergeWeights,
    stepsApplyPolicy: stepsApplyPolicy, weightApplyPolicy: weightApplyPolicy,
    isoDay: isoDay, roundStep: roundStep
  };
});
