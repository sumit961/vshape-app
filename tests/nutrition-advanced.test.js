"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const N = require("../nutrition-advanced");
// Synthetic calculation fixtures, not sourced food database records.
const food = {
  id: "fixture",
  name: "Synthetic test fixture",
  per: 100,
  unit: "g",
  k: 200,
  p: 20,
  c: 10,
  f: 5,
  preparation: "raw",
};
const entry = (id = "log", day = "2026-10-21") =>
  N.snapshot(food, 50, "g", { id, day, meal: "Lunch" });
test("full nutrition restore retains recipes, cache, favourites and historical snapshots", () => {
  let state = N.migrate({ foods: [food] });
  state = N.transact(state, {
    type: "recipe",
    recipe: {
      id: "recipe",
      name: "Fixture",
      servings: 2,
      ingredients: [{ foodId: food.id, qty: 100 }],
    },
  }).state;
  state = N.transact(state, {
    type: "log",
    entry: N.snapshot(N.recipeFood(state.recipes[0]), 0.5, "serve", {
      id: "snapshot",
      day: "2026-10-21",
      meal: "Dinner",
    }),
  }).state;
  state = N.transact(state, { type: "favourite", id: food.id }).state;
  state = N.transact(state, {
    type: "cache",
    barcode: "12345678",
    product: food,
  }).state;
  const restored = N.migrate(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(restored, state);
  assert.equal(restored.logs[0].nutrition.k, 50);
  assert.throws(
    () => N.migrate({ foods: [{ ...food, k: NaN }] }),
    /non-finite/,
  );
  assert.throws(
    () => N.transact(state, { type: "targets", kind: "other", targets: {} }),
    /invalid-target-kind/,
  );
});
test("fractional amounts, mass and volume conversions preserve unknowns", () => {
  assert.equal(N.scalePortion(food, 12.5).k, 25);
  assert.equal(N.scalePortion(food, 0.1, "kg").p, 20);
  assert.equal(N.scalePortion(food, 1).fibre, null);
  assert.equal(N.scalePortion({ ...food, unit: "ml" }, 0.25, "l").k, 500);
  assert.equal(
    N.scalePortion({ ...food, gramsPerServing: 50 }, 2, "serve").k,
    200,
  );
  assert.throws(() => N.scalePortion(food, 1, "ml"), /unit-conversion/);
  assert.throws(() => N.scalePortion(food, 1, "g", "cooked"), /raw-cooked/);
  [0, -1, NaN, Infinity, "1"].forEach((q) =>
    assert.throws(() => N.scalePortion(food, q), /quantity/),
  );
});
test("missing nutrition is explicit while known subtotal remains available", () => {
  const t = N.totals([entry(), { nutrition: { k: null, p: 2, c: 0, f: 0 } }]);
  assert.equal(t.k, null);
  assert.equal(t.known.k, 100);
  assert.equal(t.missing.k, 1);
  assert.equal(t.p, 12);
  assert.equal(t.fibre, null);
  assert.equal(N.normalizeFood({ ...food, k: 0 }).k, 0);
  assert.throws(() => N.normalizeFood({ ...food, k: -1 }));
  assert.throws(() => N.normalizeFood({ ...food, k: "200" }));
});
test("recipe totals, servings, snapshot stability, duplication and preparation", () => {
  const r = N.createRecipe(
    {
      id: "recipe",
      name: "Test recipe",
      servings: 4,
      ingredients: [
        { foodId: food.id, qty: 200, unit: "g", preparation: "raw" },
      ],
    },
    [food],
  );
  assert.equal(r.totals.k, 400);
  assert.equal(r.nutrition.k, 100);
  assert.equal(r.nutrition.fibre, null);
  const logged = N.snapshot(N.recipeFood(r), 1.5, "serve", {
    id: "rlog",
    day: "2026-10-21",
    meal: "Dinner",
  });
  const changed = N.createRecipe({ ...r, servings: 2 }, [food]);
  assert.equal(changed.nutrition.k, 200);
  assert.equal(logged.nutrition.k, 150);
  const dup = N.duplicateRecipe(r, "new");
  dup.ingredients[0].qty = 500;
  assert.equal(r.ingredients[0].qty, 200);
  assert.throws(() => N.createRecipe({ ...r, servings: 0 }, [food]));
  assert.throws(() => N.createRecipe(r, []), /missing-ingredient/);
  assert.throws(
    () =>
      N.createRecipe(
        {
          ...r,
          ingredients: [{ foodId: food.id, qty: 1, preparation: "cooked" }],
        },
        [food],
      ),
    /raw-cooked/,
  );
});
test("migration retains legacy records and targets without mutating source or duplicating reimports", () => {
  const legacy = {
    foods: [food],
    targets: { kcal: 2350, protein: 160 },
    days: {
      "2026-10-21": {
        food: [
          {
            id: "old",
            name: "Old log",
            qty: 1,
            unit: "serve",
            meal: "Snack",
            k: 10,
            p: 2,
            c: 3,
            f: 1,
          },
        ],
      },
    },
  };
  const saved = JSON.stringify(legacy),
    a = N.migrate(null, legacy),
    b = N.migrate(a, legacy);
  assert.equal(JSON.stringify(legacy), saved);
  assert.equal(b.logs.length, 1);
  assert.equal(b.foods.length, 1);
  assert.equal(b.logs[0].nutrition.fibre, null);
  assert.equal(b.targets.daily.k, 2350);
  assert.equal(b.logs[0].meal, "Snack");
  assert.deepEqual(N.migrate(JSON.parse(JSON.stringify(a))), a);
});
test("duplicate/missing IDs, malformed backups and calendar dates fail explicitly", () => {
  assert.throws(() => N.migrate({ foods: [food, food] }), /duplicate-id/);
  assert.throws(
    () => N.normalizeFood({ ...food, id: undefined }),
    /invalid-id/,
  );
  assert.throws(() => N.migrate({ logs: [entry(), entry()] }), /duplicate-id/);
  assert.throws(
    () => N.migrate({ recipes: [{ id: "broken" }] }),
    /invalid-recipe/,
  );
  assert.throws(() => N.summary(N.defaults(), "2026-02-30"), /invalid-date/);
  assert.throws(() => N.migrate({ version: 9 }), /unsupported/);
});
test("transactions log, edit, repeat/copy, delete, favourite meals and undo without input mutation", () => {
  const s = N.defaults(),
    a = N.transact(s, { type: "log", entry: entry() });
  assert.equal(s.logs.length, 0);
  assert.deepEqual(a.undo, s);
  let b = N.transact(a.state, {
    type: "copy",
    fromDay: "2026-10-21",
    day: "2026-10-22",
    ids: ["copy"],
  }).state;
  assert.equal(b.logs[1].nutrition.k, 100);
  b = N.transact(b, {
    type: "edit",
    id: "copy",
    entry: {
      ...b.logs[1],
      qty: 100,
      nutrition: { ...b.logs[1].nutrition, k: 200 },
    },
  }).state;
  assert.equal(b.logs[0].nutrition.k, 100);
  assert.throws(
    () =>
      N.transact(b, {
        type: "copy",
        fromDay: "2026-10-21",
        day: "2026-10-22",
        ids: ["copy"],
      }),
    /duplicate-id/,
  );
  b = N.transact(b, {
    type: "save-meal",
    id: "meal",
    name: "Lunch",
    day: "2026-10-21",
    meal: "Lunch",
  }).state;
  assert.equal(b.favouriteMeals[0].entries.length, 1);
  b = N.transact(b, { type: "delete", id: "log" }).state;
  assert.equal(b.logs.length, 1);
  assert.equal(b.favouriteMeals[0].entries.length, 1);
  assert.throws(
    () => N.transact(b, { type: "delete", id: "missing" }),
    /missing-log/,
  );
});
test("search supports existing/custom foods, categories, recent and favourites", () => {
  const s = N.migrate({
    foods: [{ ...food, brand: "TestBrand", category: "test", custom: true }],
    favourites: [food.id],
    recent: [food.id],
  });
  assert.equal(
    N.search(s, "TESTBRAND", {
      category: "test",
      custom: true,
      favourites: true,
      recent: true,
    }).length,
    1,
  );
  assert.equal(N.search(s, "absent").length, 0);
});
test("weekly averages exclude unconfirmed and missing days; day targets and weight trends", () => {
  const s = N.migrate({
    logs: [entry(), entry("second", "2026-10-20")],
    completeDays: ["2026-10-21"],
    targets: { daily: { k: 200, p: 20 }, training: { k: 250 }, rest: {} },
  });
  assert.equal(N.summary(s, "2026-10-21", true).remaining, 150);
  assert.equal(N.summary(s, "2026-10-21").progress.p, 0.5);
  const w = N.weekly(s, "2026-10-21");
  assert.equal(w.days.length, 7);
  assert.equal(w.averages.k.value, 100);
  assert.equal(w.averages.k.days, 1);
  assert.equal(w.averages.fibre.value, null);
  assert.equal(w.loggedDays, 2);
  assert.equal(w.adherence[5].ratio, null);
  assert.equal(
    N.weightTrend({ "2026-10-20": 80, "2026-10-21": 79.5 }).change,
    -0.5,
  );
  assert.equal(N.weightTrend({}).average, null);
  assert.equal(
    N.estimate({ currentWeightKg: 80, gender: "any" }, 30).kcal,
    2400,
  );
  assert.equal(s.targets.daily.k, 200);
});
test("offline lookup uses cache, fails safely without it and never fetches", async () => {
  const fetch = () => {
    throw new Error("must not fetch");
  };
  const r = await N.lookupBarcode("12345678", {
    online: false,
    cache: { 12345678: food },
    fetch,
  });
  assert.equal(r.cached, true);
  assert.equal(r.food.k, 200);
  await assert.rejects(
    N.lookupBarcode("12345679", { online: false, fetch }),
    /offline-cache-miss/,
  );
  await assert.rejects(N.lookupBarcode("invalid", {}), /invalid-barcode/);
});
test("network product lookup preserves missing values, units, attribution and sodium conversion", async () => {
  let request;
  const result = await N.lookupBarcode("12345678", {
    fetch: async (url, opts) => {
      request = { url, opts };
      return {
        ok: true,
        json: async () => ({
          status: "success",
          product: {
            product_name: "Synthetic API fixture",
            product_quantity_unit: "g",
            nutriments: {
              "energy-kcal_100g": 120,
              proteins_100g: 3,
              sodium_100g: 0.25,
              fiber_100g: 0,
            },
          },
        }),
      };
    },
  });
  assert.match(request.url, /api\/v3\/product/);
  assert.match(request.opts.headers["User-Agent"], /VShape/);
  assert.equal(result.food.sodium, 250);
  assert.equal(result.food.fibre, 0);
  assert.equal(result.food.f, null);
  assert.equal(result.food.verified, false);
  assert.match(result.food.source, /community/);
  await assert.rejects(
    N.lookupBarcode("12345679", {
      fetch: async () => ({
        ok: true,
        json: async () => ({ status: "success", product: { nutriments: {} } }),
      }),
    }),
    /basis-unknown/,
  );
  const fallback = await N.lookupBarcode("12345678", {
    refresh: true,
    cache: { 12345678: food },
    fetch: async () => {
      throw Error("network");
    },
  });
  assert.equal(fallback.stale, true);
});
