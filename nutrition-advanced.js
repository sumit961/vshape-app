/* Additive nutrition engine. Browser global VShapeNutrition / CommonJS. No storage writes. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.VShapeNutrition = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const nutrients = ["k", "p", "c", "f", "fibre", "sugar", "sodium"]; // kcal, grams; sodium in mg
  const clone = (x) =>
    JSON.parse(
      JSON.stringify(x, (_key, value) => {
        if (typeof value === "number" && !Number.isFinite(value))
          fail("non-finite-data");
        return value;
      }),
    );
  function fail(code) {
    throw new Error(code);
  }
  function positive(x) {
    return typeof x === "number" && Number.isFinite(x) && x > 0;
  }
  function number(x) {
    if (x == null || x === "") return null;
    if (typeof x !== "number" || !Number.isFinite(x) || x < 0)
      fail("invalid-nutrient");
    return x;
  }
  function id(x) {
    if (
      typeof x !== "string" ||
      !x.trim() ||
      ["__proto__", "constructor", "prototype"].includes(x)
    )
      fail("invalid-id");
    return x;
  }
  function unique(list) {
    const seen = new Set();
    list.forEach((x) => {
      id(x.id);
      if (seen.has(x.id)) fail("duplicate-id:" + x.id);
      seen.add(x.id);
    });
    return list;
  }
  function normalizeFood(raw) {
    if (!raw || typeof raw !== "object") fail("invalid-food");
    id(raw.id);
    if (typeof raw.name !== "string" || !raw.name.trim()) fail("missing-name");
    const out = Object.assign({}, clone(raw), {
      id: raw.id,
      name: raw.name.trim(),
      unit: raw.unit || raw.servingUnit || "serve",
      per: raw.per ?? raw.servingSize ?? 1,
      source: raw.source || "legacy / source unspecified",
      custom: !!raw.custom,
    });
    if (!positive(out.per)) fail("invalid-serving");
    if (typeof out.unit !== "string" || !out.unit.trim()) fail("invalid-unit");
    nutrients.forEach((n) => (out[n] = number(raw[n])));
    out.preparation = raw.preparation || "unspecified";
    const portionNames = new Set();
    out.portions = (raw.portions || []).map((p) => {
      if (!p.name || !positive(p.qty) || !p.unit || portionNames.has(p.name))
        fail("invalid-portion");
      portionNames.add(p.name);
      return clone(p);
    });
    return out;
  }
  function scalePortion(food, qty, unit, preparation) {
    const f = normalizeFood(food);
    if (!positive(qty)) fail("invalid-quantity");
    unit = unit || f.unit;
    if (preparation && preparation !== f.preparation)
      fail("raw-cooked-conversion-unknown");
    let amount = qty;
    if (unit !== f.unit) {
      const mass = { g: 1, kg: 1000, oz: 28.349523125 },
        volume = { ml: 1, l: 1000 };
      const group =
        mass[unit] && mass[f.unit]
          ? mass
          : volume[unit] && volume[f.unit]
            ? volume
            : null;
      if (group) amount = (qty * group[unit]) / group[f.unit];
      else if (
        unit === "serve" &&
        positive(f.gramsPerServing) &&
        f.unit === "g"
      )
        amount = qty * f.gramsPerServing;
      else fail("unit-conversion-unknown");
    }
    const out = {};
    nutrients.forEach(
      (n) => (out[n] = f[n] == null ? null : (f[n] * amount) / f.per),
    );
    return out;
  }
  function totals(entries) {
    const out = { count: entries.length, known: {}, missing: {} };
    nutrients.forEach((n) => {
      const values = entries.map((e) => (e.nutrition ? e.nutrition[n] : e[n]));
      out.known[n] = values.reduce(
        (a, v) => a + (v == null ? 0 : number(v)),
        0,
      );
      out.missing[n] = values.filter((v) => v == null).length;
      out[n] = out.missing[n] ? null : out.known[n];
    });
    return out;
  }
  function defaults() {
    return {
      version: 1,
      foods: [],
      recipes: [],
      logs: [],
      favourites: [],
      recent: [],
      favouriteMeals: [],
      mealGroups: ["Breakfast", "Lunch", "Dinner", "Snacks"],
      targets: { daily: {}, training: {}, rest: {} },
      completeDays: [],
      productCache: {},
    };
  }
  function dayKey(value) {
    if (
      typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value + "T12:00:00Z")) ||
      new Date(value + "T12:00:00Z").toISOString().slice(0, 10) !== value
    )
      fail("invalid-date");
    return value;
  }
  function shiftDay(day, offset) {
    dayKey(day);
    const d = new Date(day + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  }
  function validateLog(e) {
    if (!e || typeof e !== "object") fail("invalid-log");
    id(e.id);
    dayKey(e.day);
    if (!e.name || !e.meal || !positive(e.qty) || !e.unit) fail("invalid-log");
    const out = clone(e);
    out.nutrition = Object.fromEntries(
      nutrients.map((n) => [n, number((e.nutrition || e)[n])]),
    );
    return out;
  }
  function migrate(saved, legacy) {
    const out = Object.assign(defaults(), clone(saved || {}));
    if (out.version !== 1) fail("unsupported-version");
    [
      "foods",
      "recipes",
      "logs",
      "favourites",
      "recent",
      "favouriteMeals",
      "mealGroups",
      "completeDays",
    ].forEach((k) => {
      if (!Array.isArray(out[k])) fail("invalid-" + k);
    });
    out.foods = unique(out.foods.map(normalizeFood));
    out.logs = unique(out.logs.map(validateLog));
    unique(out.recipes);
    unique(out.favouriteMeals);
    out.recipes.forEach((r) => {
      if (
        !r.name ||
        !positive(r.servings) ||
        !Array.isArray(r.ingredients) ||
        !r.ingredients.length ||
        !r.nutrition
      )
        fail("invalid-recipe");
      r.ingredients.forEach((i) => {
        id(i.foodId);
        if (!positive(i.qty) || !i.nutrition) fail("invalid-ingredient");
        nutrients.forEach((n) => number(i.nutrition[n]));
      });
      nutrients.forEach((n) => number(r.nutrition[n]));
    });
    out.favouriteMeals.forEach((m) => {
      if (!m.name || !Array.isArray(m.entries)) fail("invalid-favourite-meal");
      unique(m.entries.map(validateLog));
    });
    ["favourites", "recent"].forEach((k) => out[k].forEach(id));
    out.mealGroups.forEach((m) => {
      if (typeof m !== "string" || !m.trim()) fail("invalid-meal-group");
    });
    if (
      !out.productCache ||
      typeof out.productCache !== "object" ||
      Array.isArray(out.productCache)
    )
      fail("invalid-cache");
    Object.values(out.productCache).forEach(normalizeFood);
    out.targets = Object.assign(
      { daily: {}, training: {}, rest: {} },
      out.targets,
    );
    Object.values(out.targets).forEach((t) => {
      if (!t || typeof t !== "object") fail("invalid-targets");
      nutrients.forEach((n) => number(t[n]));
    });
    out.completeDays.forEach(dayKey);
    if (legacy) {
      const seen = new Set(out.foods.map((f) => f.id));
      unique(legacy.foods || []).forEach((f) => {
        if (!seen.has(f.id)) {
          out.foods.push(normalizeFood(f));
          seen.add(f.id);
        }
      });
      Object.entries(legacy.days || {}).forEach(([day, d]) =>
        unique(d.food || []).forEach((e) => {
          const key = "legacy:" + day + ":" + id(e.id);
          if (!out.logs.some((x) => x.id === key))
            out.logs.push(
              validateLog(
                Object.assign({}, clone(e), {
                  id: key,
                  legacyId: e.id,
                  day,
                  nutrition: Object.fromEntries(
                    nutrients.map((n) => [n, number(e[n])]),
                  ),
                }),
              ),
            );
        }),
      );
      if (!saved?.targets)
        out.targets.daily = {
          k: number(legacy.targets?.kcal),
          p: number(legacy.targets?.protein),
        };
    }
    out.logs.forEach((e) => {
      if (!out.mealGroups.includes(e.meal)) out.mealGroups.push(e.meal);
    });
    return out;
  }
  function search(state, query, filter) {
    query = (query || "").toLowerCase();
    filter = filter || {};
    return state.foods
      .filter(
        (f) =>
          (f.name + " " + (f.brand || "") + " " + (f.barcode || ""))
            .toLowerCase()
            .includes(query) &&
          (!filter.category || f.category === filter.category) &&
          (!filter.custom || f.custom) &&
          (!filter.favourites || state.favourites.includes(f.id)) &&
          (!filter.recent || state.recent.includes(f.id)),
      )
      .sort((a, b) =>
        filter.recent
          ? state.recent.indexOf(a.id) - state.recent.indexOf(b.id)
          : a.name.localeCompare(b.name),
      );
  }
  function snapshot(food, qty, unit, meta) {
    id(meta.id);
    dayKey(meta.day);
    if (!meta.meal) fail("missing-meal");
    return Object.assign({}, clone(meta), {
      foodId: food.id,
      name: food.name,
      qty,
      unit: unit || food.unit,
      preparation: food.preparation || "unspecified",
      nutrition: scalePortion(food, qty, unit),
      source: food.source || "legacy / source unspecified",
    });
  }
  function createRecipe(input, foods) {
    id(input.id);
    if (
      !input.name ||
      !positive(input.servings) ||
      !Array.isArray(input.ingredients) ||
      !input.ingredients.length
    )
      fail("invalid-recipe");
    const ingredients = input.ingredients.map((i) => {
      const f = foods.find((f) => f.id === i.foodId);
      if (!f) fail("missing-ingredient:" + i.foodId);
      return Object.assign({}, clone(i), {
        name: f.name,
        nutrition: scalePortion(f, i.qty, i.unit, i.preparation),
        preparation: i.preparation || f.preparation || "unspecified",
      });
    });
    const total = totals(ingredients);
    return Object.assign({}, clone(input), {
      ingredients,
      totals: total,
      nutrition: Object.fromEntries(
        nutrients.map((n) => [
          n,
          total[n] == null ? null : total[n] / input.servings,
        ]),
      ),
      assumption:
        "Ingredient nutrition is summed as measured. No cooked/raw or cooking-yield conversion is assumed.",
    });
  }
  function recipeFood(r) {
    return Object.assign(
      {
        id: r.id,
        name: r.name,
        unit: "serve",
        per: 1,
        source: "user recipe",
        preparation: "recipe",
      },
      r.nutrition,
    );
  }
  function duplicateRecipe(r, newId) {
    id(newId);
    if (newId === r.id) fail("duplicate-id");
    return Object.assign(clone(r), { id: newId, name: r.name + " (copy)" });
  }
  function targetsFor(state, training) {
    return Object.assign(
      {},
      state.targets.daily,
      state.targets[training ? "training" : "rest"],
    );
  }
  function summary(state, day, training) {
    dayKey(day);
    const entries = state.logs.filter((e) => e.day === day),
      sum = totals(entries),
      targets = targetsFor(state, training);
    return {
      day,
      totals: sum,
      targets,
      complete: state.completeDays.includes(day),
      remaining: sum.k == null || targets.k == null ? null : targets.k - sum.k,
      progress: Object.fromEntries(
        nutrients.map((n) => [
          n,
          sum[n] == null || !positive(targets[n]) ? null : sum[n] / targets[n],
        ]),
      ),
      meals: Object.fromEntries(
        [...new Set(entries.map((e) => e.meal))].map((m) => [
          m,
          totals(entries.filter((e) => e.meal === m)),
        ]),
      ),
    };
  }
  function weekly(state, end, trainingDays) {
    const days = Array.from({ length: 7 }, (_, i) =>
      summary(
        state,
        shiftDay(end, i - 6),
        (trainingDays || []).includes(shiftDay(end, i - 6)),
      ),
    );
    return {
      days,
      loggedDays: days.filter((d) => d.totals.count).length,
      completeDays: days.filter((d) => d.complete).length,
      averages: Object.fromEntries(
        nutrients.map((n) => {
          const valid = days.filter((d) => d.complete && d.totals[n] != null);
          return [
            n,
            {
              value: valid.length
                ? valid.reduce((a, d) => a + d.totals[n], 0) / valid.length
                : null,
              days: valid.length,
            },
          ];
        }),
      ),
      adherence: days.map((d) => ({
        day: d.day,
        ratio: d.complete ? d.progress.k : null,
      })),
    };
  }
  function weightTrend(weights, start, end) {
    const points = Object.entries(weights || {})
      .filter(
        ([d, w]) => (!start || d >= start) && (!end || d <= end) && positive(w),
      )
      .sort(([a], [b]) => a.localeCompare(b));
    return {
      points,
      average: points.length
        ? points.reduce((s, p) => s + p[1], 0) / points.length
        : null,
      change: points.length > 1 ? points.at(-1)[1] - points[0][1] : null,
    };
  }
  // Optional transparent estimate: caller supplies kcal/kg assumption, never inferred from gender.
  function estimate(profile, kcalPerKg) {
    if (!positive(profile.currentWeightKg) || !positive(kcalPerKg))
      fail("missing-estimate-input");
    return {
      kcal: profile.currentWeightKg * kcalPerKg,
      assumption:
        "Weight × user-selected " +
        kcalPerKg +
        " kcal/kg. Informational starting estimate only; activity, age, training and individual needs can differ. No target is applied.",
    };
  }
  function transact(state, action) {
    const next = clone(state);
    const find = () => {
      const i = next.logs.findIndex((e) => e.id === action.id);
      if (i < 0) fail("missing-log");
      return i;
    };
    switch (action.type) {
      case "food": {
        const f = normalizeFood(action.food),
          i = next.foods.findIndex((x) => x.id === f.id);
        if (i < 0) next.foods.push(f);
        else next.foods[i] = f;
        break;
      }
      case "log":
        validateLog(action.entry);
        if (next.logs.some((e) => e.id === action.entry.id))
          fail("duplicate-id");
        next.logs.push(clone(action.entry));
        if (action.entry.foodId)
          next.recent = [
            action.entry.foodId,
            ...next.recent.filter((x) => x !== action.entry.foodId),
          ].slice(0, 30);
        break;
      case "edit": {
        const i = find();
        if (action.entry.id !== action.id) fail("id-changed");
        next.logs[i] = validateLog(action.entry);
        break;
      }
      case "delete":
        next.logs.splice(find(), 1);
        break;
      case "favourite":
        id(action.id);
        next.favourites = next.favourites.includes(action.id)
          ? next.favourites.filter((x) => x !== action.id)
          : next.favourites.concat(action.id);
        break;
      case "recipe": {
        const r = createRecipe(action.recipe, next.foods),
          i = next.recipes.findIndex((x) => x.id === r.id);
        if (i < 0) next.recipes.push(r);
        else next.recipes[i] = r;
        break;
      }
      case "save-meal":
        id(action.id);
        if (next.favouriteMeals.some((m) => m.id === action.id))
          fail("duplicate-id");
        next.favouriteMeals.push({
          id: action.id,
          name: action.name,
          entries: clone(
            next.logs.filter(
              (e) => e.day === action.day && e.meal === action.meal,
            ),
          ),
        });
        break;
      case "copy": {
        dayKey(action.day);
        const entries =
          action.entries ||
          next.logs.filter(
            (e) =>
              e.day === action.fromDay &&
              (!action.meal || e.meal === action.meal),
          );
        if (!Array.isArray(action.ids) || action.ids.length !== entries.length)
          fail("copy-ids-required");
        entries.forEach((e, i) =>
          next.logs.push(
            validateLog(
              Object.assign({}, clone(e), {
                id: action.ids[i],
                day: action.day,
                meal: action.toMeal || e.meal,
              }),
            ),
          ),
        );
        unique(next.logs);
        break;
      }
      case "targets":
        if (!["daily", "training", "rest"].includes(action.kind || "daily"))
          fail("invalid-target-kind");
        next.targets[action.kind || "daily"] = clone(action.targets);
        break;
      case "complete":
        dayKey(action.day);
        next.completeDays = next.completeDays.filter((d) => d !== action.day);
        if (action.complete) next.completeDays.push(action.day);
        break;
      case "meal-group":
        if (!action.name?.trim()) fail("missing-meal");
        if (!next.mealGroups.includes(action.name.trim()))
          next.mealGroups.push(action.name.trim());
        break;
      case "cache":
        next.productCache[id(action.barcode)] = clone(action.product);
        break;
      default:
        fail("unknown-action");
    }
    return { state: migrate(next), undo: clone(state) };
  }
  let productRequests = [];
  async function lookupBarcode(code, options) {
    options = options || {};
    if (!/^\d{8,14}$/.test(code)) fail("invalid-barcode");
    const cached = options.cache?.[code];
    if (cached && !options.refresh)
      return { food: normalizeFood(cached), cached: true };
    if (options.online === false) {
      if (cached)
        return { food: normalizeFood(cached), cached: true, offline: true };
      fail("offline-cache-miss");
    }
    const fetcher = options.fetch || ((...a) => fetch(...a));
    try {
      const now = Date.now();
      productRequests = productRequests.filter((t) => now - t < 60000);
      if (productRequests.length >= 12)
        fail("product-rate-limit-wait-one-minute");
      productRequests.push(now);
      const response = await fetcher(
        "https://world.openfoodfacts.org/api/v3/product/" +
          code +
          "?fields=code,product_name,brands,nutriments,product_quantity_unit",
        {
          headers: {
            "User-Agent": "VShape/1.0 (https://github.com/sumit961/vshape-app)",
          },
          signal: options.signal || globalThis.AbortSignal?.timeout?.(10000),
        },
      );
      if (!response.ok) fail("product-http-" + response.status);
      const data = await response.json();
      if (
        ![
          "success",
          "success_with_warnings",
          "success_with_errors",
          1,
        ].includes(data.status) ||
        !data.product
      )
        fail("product-not-found");
      const p = data.product,
        n = p.nutriments || {};
      const read = (k) =>
        typeof n[k] === "number" && Number.isFinite(n[k]) && n[k] >= 0
          ? n[k]
          : null;
      if (!["g", "ml"].includes(p.product_quantity_unit))
        fail("product-basis-unknown");
      const food = normalizeFood({
        id: "off:" + code,
        barcode: code,
        name: p.product_name || "Unnamed product " + code,
        brand: p.brands || "",
        per: 100,
        unit: p.product_quantity_unit,
        k: read("energy-kcal_100g"),
        p: read("proteins_100g"),
        c: read("carbohydrates_100g"),
        f: read("fat_100g"),
        fibre: read("fiber_100g"),
        sugar: read("sugars_100g"),
        sodium: read("sodium_100g") == null ? null : read("sodium_100g") * 1000,
        source:
          "Open Food Facts (ODbL), community submitted; verify against packaging",
        verified: false,
        sourceUrl: "https://world.openfoodfacts.org/product/" + code,
      });
      return { food, cached: false };
    } catch (error) {
      if (cached)
        return {
          food: normalizeFood(cached),
          cached: true,
          stale: true,
          error: error.message,
        };
      throw error;
    }
  }
  return {
    nutrients,
    defaults,
    migrate,
    normalizeFood,
    scalePortion,
    totals,
    search,
    snapshot,
    createRecipe,
    recipeFood,
    duplicateRecipe,
    targetsFor,
    summary,
    weekly,
    weightTrend,
    estimate,
    transact,
    lookupBarcode,
    shiftDay,
  };
});
