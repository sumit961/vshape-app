package app.vshape.tracker;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

/**
 * Local JVM unit tests for WorkoutLogic - the pure, Android-independent helpers the
 * notification uses to validate and walk forward through a workout natively (Phase 2B.3).
 * These deliberately mirror core.js's validateSet/pendingSetsList/sessionSetsDone; see the
 * matching tests in tests/core.test.js for the JS side of the same rules.
 *
 * Runs against the real org.json reference implementation (see app/build.gradle's
 * testImplementation 'org.json:json:...') rather than Android's stub classes, which throw at
 * runtime under a plain local unit test.
 */
public class WorkoutLogicTest {

    private JSONObject ex(String id, String name, int sets, int restSec, boolean assisted) throws Exception {
        JSONObject e = new JSONObject();
        e.put("id", id);
        e.put("name", name);
        e.put("sets", sets);
        e.put("rest", restSec);
        e.put("assisted", assisted);
        return e;
    }

    @Test
    public void isValidSet_rejectsNonFiniteWeightAndNonPositiveReps() throws Exception {
        JSONObject e = ex("a", "A", 3, 90, false);
        assertFalse(WorkoutLogic.isValidSet(e, Double.NaN, 8));
        assertFalse(WorkoutLogic.isValidSet(e, Double.POSITIVE_INFINITY, 8));
        assertFalse(WorkoutLogic.isValidSet(e, 20, 0));
        assertFalse(WorkoutLogic.isValidSet(e, 20, -1));
        assertTrue(WorkoutLogic.isValidSet(e, 20, 8));
    }

    @Test
    public void isValidSet_rejectsNegativeWeightUnlessAssisted() throws Exception {
        JSONObject normal = ex("a", "A", 3, 90, false);
        JSONObject assisted = ex("b", "Pull-up", 2, 90, true);
        assertFalse(WorkoutLogic.isValidSet(normal, -5, 8));
        assertTrue(WorkoutLogic.isValidSet(assisted, -5, 8));
    }

    @Test
    public void mergeLog_overlaysNativeCommitsOnTopOfCommittedLogWithoutMutatingTheOriginal() throws Exception {
        JSONObject committedLog = new JSONObject();
        JSONArray existing = new JSONArray();
        JSONObject firstSet = new JSONObject().put("w", 20).put("r", 8);
        existing.put(firstSet);
        committedLog.put("a", existing);

        JSONArray nativeCommits = new JSONArray();
        nativeCommits.put(new JSONObject().put("exId", "a").put("index", 1).put("w", 22).put("r", 7));
        nativeCommits.put(new JSONObject().put("exId", "b").put("index", 0).put("w", 10).put("r", 10));

        JSONObject merged = WorkoutLogic.mergeLog(committedLog, nativeCommits);

        assertEquals(20.0, merged.getJSONArray("a").getJSONObject(0).getDouble("w"), 0.001);
        assertEquals(22.0, merged.getJSONArray("a").getJSONObject(1).getDouble("w"), 0.001);
        assertEquals(10.0, merged.getJSONArray("b").getJSONObject(0).getDouble("w"), 0.001);
        // The original committedLog passed in must not be mutated by the merge.
        assertEquals(1, committedLog.getJSONArray("a").length());
    }

    @Test
    public void isAlreadyLogged_trueOnlyForANonNullEntryAtThatExactIndex() throws Exception {
        JSONObject log = new JSONObject();
        JSONArray arr = new JSONArray();
        arr.put(new JSONObject().put("w", 20).put("r", 8));
        arr.put((Object) null);
        log.put("a", arr);

        assertTrue(WorkoutLogic.isAlreadyLogged(log, "a", 0));
        assertFalse(WorkoutLogic.isAlreadyLogged(log, "a", 1));
        assertFalse(WorkoutLogic.isAlreadyLogged(log, "a", 5));
        assertFalse(WorkoutLogic.isAlreadyLogged(log, "unknown-exercise", 0));
    }

    @Test
    public void nextPendingSet_walksExercisesAndSetsInOrderAndReturnsNullOnceEverythingIsLogged() throws Exception {
        JSONArray exSnapshot = new JSONArray();
        exSnapshot.put(ex("a", "A", 2, 90, false));
        exSnapshot.put(ex("b", "B", 1, 60, false));
        JSONObject emptyLog = new JSONObject();

        JSONObject first = WorkoutLogic.nextPendingSet(exSnapshot, emptyLog);
        assertEquals("a", first.getString("exId"));
        assertEquals(0, first.getInt("setIndex"));

        JSONObject log1 = new JSONObject();
        JSONArray a = new JSONArray();
        a.put(new JSONObject().put("w", 20).put("r", 8));
        log1.put("a", a);
        JSONObject second = WorkoutLogic.nextPendingSet(exSnapshot, log1);
        assertEquals("a", second.getString("exId"));
        assertEquals(1, second.getInt("setIndex"));

        JSONObject log2 = new JSONObject();
        JSONArray aFull = new JSONArray();
        aFull.put(new JSONObject().put("w", 20).put("r", 8));
        aFull.put(new JSONObject().put("w", 20).put("r", 7));
        log2.put("a", aFull);
        JSONObject third = WorkoutLogic.nextPendingSet(exSnapshot, log2);
        assertEquals("b", third.getString("exId"));
        assertEquals(0, third.getInt("setIndex"));

        JSONObject log3 = new JSONObject();
        log3.put("a", aFull);
        JSONArray bFull = new JSONArray();
        bFull.put(new JSONObject().put("w", 10).put("r", 10));
        log3.put("b", bFull);
        assertNull(WorkoutLogic.nextPendingSet(exSnapshot, log3));
    }

    @Test
    public void nextPendingSet_seesANativeCommitImmediatelyWithoutWaitingForJsToReconcile() throws Exception {
        // This is the core "no live background logging" fix: a set committed by this device
        // (not yet reconciled into JS's committedLog) must still count as logged for the
        // purpose of walking forward to the NEXT pending set.
        JSONArray exSnapshot = new JSONArray();
        exSnapshot.put(ex("a", "A", 1, 90, false));
        exSnapshot.put(ex("b", "B", 1, 60, false));
        JSONObject committedLog = new JSONObject(); // JS has not reconciled anything yet
        JSONArray nativeCommits = new JSONArray();
        nativeCommits.put(new JSONObject().put("exId", "a").put("index", 0).put("w", 20).put("r", 8));

        JSONObject merged = WorkoutLogic.mergeLog(committedLog, nativeCommits);
        JSONObject pending = WorkoutLogic.nextPendingSet(exSnapshot, merged);
        assertEquals("b", pending.getString("exId"));
    }

    @Test
    public void setsDoneTotal_countsAcrossAllExercisesFromTheMergedLog() throws Exception {
        JSONArray exSnapshot = new JSONArray();
        exSnapshot.put(ex("a", "A", 2, 90, false));
        exSnapshot.put(ex("b", "B", 3, 60, false));
        JSONObject log = new JSONObject();
        JSONArray a = new JSONArray();
        a.put(new JSONObject().put("w", 20).put("r", 8));
        log.put("a", a);

        int[] doneTotal = WorkoutLogic.setsDoneTotal(exSnapshot, log);
        assertEquals(1, doneTotal[0]);
        assertEquals(5, doneTotal[1]);
    }

    @Test
    public void exerciseSetsDone_countsOnlyTheNamedExercise() throws Exception {
        JSONObject log = new JSONObject();
        JSONArray a = new JSONArray();
        a.put(new JSONObject().put("w", 20).put("r", 8));
        a.put(new JSONObject().put("w", 20).put("r", 7));
        log.put("a", a);
        JSONArray b = new JSONArray();
        b.put(new JSONObject().put("w", 10).put("r", 10));
        log.put("b", b);

        assertEquals(2, WorkoutLogic.exerciseSetsDone(log, "a"));
        assertEquals(1, WorkoutLogic.exerciseSetsDone(log, "b"));
        assertEquals(0, WorkoutLogic.exerciseSetsDone(log, "unknown"));
    }

    @Test
    public void suggestedWAndR_lookUpFromTheLookaheadTableAndDefaultToZeroWhenMissing() throws Exception {
        JSONArray suggestions = new JSONArray();
        JSONObject sugA = new JSONObject();
        sugA.put("exId", "a");
        sugA.put("w", 22.5);
        JSONArray reps = new JSONArray();
        reps.put(8).put(7).put(6);
        sugA.put("reps", reps);
        suggestions.put(sugA);

        assertEquals(22.5, WorkoutLogic.suggestedW(suggestions, "a"), 0.001);
        assertEquals(7, WorkoutLogic.suggestedR(suggestions, "a", 1));
        assertEquals(0.0, WorkoutLogic.suggestedW(suggestions, "unknown"), 0.001);
        assertEquals(0, WorkoutLogic.suggestedR(suggestions, "a", 99)); // out of range -> honest default, not a crash
    }

    // syncRestFromState: the fix for "rest countdown missing from the notification". Before
    // this fix, WorkoutForegroundService unconditionally cleared nativeRest on every fresh JS
    // push, so a rest started from the in-app UI (as opposed to a notification Log Set tap)
    // never made it into nativeRest at all - and buildActiveNotification() decides "is
    // resting" purely from nativeRest, never from the JS payload directly.

    @Test
    public void syncRestFromState_establishesARunningRestFromAnActiveNonPausedPayload() throws Exception {
        JSONObject s = new JSONObject();
        s.put("sessionId", "sess1");
        s.put("restActive", true);
        s.put("restPaused", false);
        s.put("restDeadlineEpochMs", 123456789L);
        s.put("exId", "incline-db");
        s.put("exerciseName", "Incline Dumbbell Press");

        WorkoutLogic.NativeRestSync sync = WorkoutLogic.syncRestFromState(s);

        assertEquals("sess1", sync.sessionId);
        assertEquals(123456789L, sync.deadlineEpochMs);
        assertNull(sync.pausedRemainingMs);
        assertEquals("incline-db", sync.exId);
        assertEquals("Incline Dumbbell Press", sync.exName);
    }

    @Test
    public void syncRestFromState_establishesAPausedRestFromThePausedRemainingMsField() throws Exception {
        JSONObject s = new JSONObject();
        s.put("sessionId", "sess1");
        s.put("restActive", true);
        s.put("restPaused", true);
        s.put("restRemainingMs", 42000L);
        s.put("exId", "incline-db");
        s.put("exerciseName", "Incline Dumbbell Press");

        WorkoutLogic.NativeRestSync sync = WorkoutLogic.syncRestFromState(s);

        assertEquals(Long.valueOf(42000L), sync.pausedRemainingMs);
    }

    @Test
    public void syncRestFromState_returnsNullWhenRestIsNotActiveAtAll() throws Exception {
        JSONObject s = new JSONObject();
        s.put("restActive", false);
        assertNull(WorkoutLogic.syncRestFromState(s));
        assertNull(WorkoutLogic.syncRestFromState(new JSONObject())); // field missing entirely -> same as false
    }

    @Test
    public void syncRestFromState_failsSafeToNullWhenRestIsActiveButTheDeadlineIsMissingOrInvalid() throws Exception {
        JSONObject missing = new JSONObject();
        missing.put("restActive", true);
        missing.put("restPaused", false);
        // no restDeadlineEpochMs at all
        assertNull(WorkoutLogic.syncRestFromState(missing));

        JSONObject zero = new JSONObject();
        zero.put("restActive", true);
        zero.put("restPaused", false);
        zero.put("restDeadlineEpochMs", 0L);
        assertNull(WorkoutLogic.syncRestFromState(zero));
    }
}
