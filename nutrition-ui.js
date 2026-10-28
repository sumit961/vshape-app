(function (root, factory) {
  if (typeof module === "object" && module.exports)
    module.exports = factory(require("./nutrition-advanced"));
  else root.VShapeNutritionUI = factory(root.VShapeNutrition);
})(typeof self !== "undefined" ? self : this, function (N) {
  "use strict";
  const esc = (x) =>
    String(x ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  const value = (x) => (x == null ? "Unknown" : Math.round(x * 10) / 10);
  const units = [
    "g",
    "kg",
    "ml",
    "l",
    "each",
    "serve",
    "slice",
    "scoop",
    "cup",
    "tbsp",
    "tsp",
    "oz",
  ];
  function options(values, selected) {
    return values
      .map(
        (v) =>
          "<option " +
          (v === selected ? "selected " : "") +
          'value="' +
          esc(v) +
          '">' +
          esc(v) +
          "</option>",
      )
      .join("");
  }
  function input(name, label, val, type) {
    return (
      "<label>" +
      esc(label) +
      '<input name="' +
      name +
      '" type="' +
      (type || "number") +
      '" ' +
      ((type || "number") === "number" ? 'min="0" step="any" ' : "") +
      'value="' +
      esc(val) +
      '"></label>'
    );
  }
  function nutritionFields(v) {
    return N.nutrients
      .map((n) =>
        input(
          n,
          {
            k: "Calories (kcal)",
            p: "Protein (g)",
            c: "Carbohydrates (g)",
            f: "Fat (g)",
            fibre: "Fibre (g)",
            sugar: "Sugar (g)",
            sodium: "Sodium (mg)",
          }[n],
          v[n],
        ),
      )
      .join("");
  }
  function mount(host, config) {
    if (!N) throw new Error("nutrition-engine-required");
    const today = new Date();
    let state = N.migrate(config.state),
      day =
        config.day ||
        [
          today.getFullYear(),
          String(today.getMonth() + 1).padStart(2, "0"),
          String(today.getDate()).padStart(2, "0"),
        ].join("-"),
      query = "",
      filter = "",
      category = "",
      undo = null,
      busy = false,
      active = true,
      recipeDraft = null,
      foodDraft = null;
    const makeId =
      config.makeId ||
      (() => {
        if (!globalThis.crypto?.randomUUID)
          throw new Error("host-makeId-required");
        return globalThis.crypto.randomUUID();
      });
    const training = (d) => (config.trainingDays || []).includes(d);
    function announce(message, error) {
      const el = host.querySelector("[data-status]");
      if (el) {
        el.textContent = message;
        el.setAttribute("role", error ? "alert" : "status");
      }
    }
    async function commit(action) {
      if (busy) return false;
      busy = true;
      try {
        const result = N.transact(state, action);
        await config.onChange(result.state, { action, previous: state });
        if (active) {
          undo = state;
          state = result.state;
          render();
          announce("Saved");
        }
        return active;
      } catch (e) {
        if (active) announce(e.message, true);
        return false;
      } finally {
        busy = false;
      }
    }
    const mealSelect = () =>
      '<label>Meal<select name="meal">' +
      options(state.mealGroups) +
      "</select></label>";
    function foodForm() {
      const f = foodDraft || {};
      return (
        "<details " +
        (foodDraft ? "open" : "") +
        "><summary>" +
        (foodDraft ? "Edit food / correct label" : "Create custom food") +
        '</summary><form data-form="food">' +
        input("name", "Food name", f.name, "text") +
        input("brand", "Brand (optional)", f.brand, "text") +
        input("barcode", "Barcode (optional)", f.barcode, "text") +
        input("category", "Category (optional)", f.category, "text") +
        input("per", "Nutrition is per amount", f.per ?? 100) +
        '<label>Unit<select name="unit">' +
        options(units, f.unit || "g") +
        '</select></label><label>Measurement state<select name="preparation">' +
        options(["unspecified", "raw", "cooked", "as sold"], f.preparation) +
        "</select></label><p>Leave unavailable nutrients blank. Sodium is milligrams. Enter values for the selected measurement state.</p>" +
        nutritionFields(f) +
        "<button>Save food</button></form></details>"
      );
    }
    function render() {
      const s = N.summary(state, day, training(day)),
        w = N.weekly(state, day, config.trainingDays),
        entries = state.logs.filter((e) => e.day === day),
        foods = N.search(state, query, {
          favourites: filter === "favourites",
          recent: filter === "recent",
          custom: filter === "custom",
          category,
        });
      host.classList.add("vshape-nutrition");
      host.innerHTML =
        '<div data-status role="status" aria-live="polite"></div><header><h2>Nutrition</h2><button data-action="previous" aria-label="Previous day">Previous</button><label>Day<input data-day type="date" value="' +
        esc(day) +
        '"></label><button data-action="next" aria-label="Next day">Next</button></header><section aria-label="Daily nutrition"><h3>Daily progress</h3><p>' +
        value(s.totals.k) +
        " kcal · Remaining " +
        value(s.remaining) +
        " kcal</p>" +
        N.nutrients
          .map(
            (n) =>
              "<p>" +
              esc(
                {
                  k: "Calories",
                  p: "Protein",
                  c: "Carbohydrates",
                  f: "Fat",
                  fibre: "Fibre",
                  sugar: "Sugar",
                  sodium: "Sodium",
                }[n],
              ) +
              ": " +
              value(s.totals[n]) +
              " / " +
              value(s.targets[n]) +
              (s.totals.missing[n]
                ? " — incomplete (" + value(s.totals.known[n]) + " known)"
                : "") +
              (s.progress[n] != null
                ? " · " + Math.round(s.progress[n] * 100) + "%"
                : "") +
              "</p>",
          )
          .join("") +
        '<label><input data-complete type="checkbox" ' +
        (s.complete ? "checked" : "") +
        ">All food for this day is logged (include day in averages)</label></section><section><h3>Seven-day history</h3><p>" +
        w.completeDays +
        " complete days; averages exclude incomplete days.</p><ul>" +
        w.days
          .map(
            (d) =>
              "<li>" +
              esc(d.day) +
              ": " +
              (d.totals.count ? value(d.totals.k) + " kcal" : "No entries") +
              " · " +
              (d.complete ? "Complete" : "Incomplete") +
              (d.complete && d.progress.k != null
                ? " · " + Math.round(d.progress.k * 100) + "% of calorie target"
                : "") +
              "</li>",
          )
          .join("") +
        "</ul><p>" +
        N.nutrients
          .map(
            (n) =>
              esc(n) +
              ": " +
              value(w.averages[n].value) +
              " (" +
              w.averages[n].days +
              " days)",
          )
          .join(" · ") +
        "</p>" +
        (config.weights
          ? "<p>Weight trend: " +
            value(
              N.weightTrend(config.weights, N.shiftDay(day, -6), day).change,
            ) +
            " kg change across recorded measurements</p>"
          : "") +
        "</section>";
      host.innerHTML +=
        '<section><h3>Food library</h3><form data-form="search">' +
        input("query", "Search name, brand or barcode", query, "search") +
        '<label>Show<select name="filter">' +
        options(["", "recent", "favourites", "custom"], filter) +
        '</select></label><label>Category<select name="category">' +
        options(
          ["", ...new Set(state.foods.map((f) => f.category).filter(Boolean))],
          category,
        ) +
        "</select></label><button>Search</button></form><div>" +
        foods
          .map(
            (f) =>
              "<article><h4>" +
              esc(f.name) +
              "</h4><p>" +
              esc(f.brand) +
              " · " +
              value(f.k) +
              " kcal per " +
              f.per +
              " " +
              esc(f.unit) +
              " · " +
              esc(f.preparation) +
              "</p><p>" +
              esc(f.source) +
              '</p><form data-form="log" data-id="' +
              esc(f.id) +
              '">' +
              mealSelect() +
              input("qty", "Quantity (" + f.unit + ")", f.def || f.per) +
              '<label>Reusable portion<select name="portion">' +
              options(["", ...f.portions.map((p) => p.name)]) +
              '</select></label><button>Add food</button></form><button data-action="favourite" data-id="' +
              esc(f.id) +
              '" aria-pressed="' +
              state.favourites.includes(f.id) +
              '">' +
              (state.favourites.includes(f.id)
                ? "★ Favourite"
                : "☆ Favourite") +
              '</button><button data-action="edit-food" data-id="' +
              esc(f.id) +
              '">Edit food / label</button></article>',
          )
          .join("") +
        "</div>" +
        foodForm() +
        '<details><summary>Save a reusable portion</summary><form data-form="portion"><label>Food<select name="foodId">' +
        state.foods
          .map(
            (f) =>
              '<option value="' + esc(f.id) + '">' + esc(f.name) + "</option>",
          )
          .join("") +
        "</select></label>" +
        input("name", "Portion name (e.g. my bowl)", "", "text") +
        input("qty", "Amount", 1) +
        '<label>Unit<select name="unit">' +
        options(units) +
        "</select></label><button>Save portion</button></form></details></section>";
      host.innerHTML +=
        '<section><h3>Logged meals</h3><button data-action="undo" ' +
        (!undo ? "disabled" : "") +
        '>Undo last change</button><button data-action="yesterday">Copy yesterday</button>' +
        state.mealGroups
          .map(
            (m) =>
              "<article><h4>" +
              esc(m) +
              "</h4><p>" +
              value(s.meals[m]?.k ?? (s.meals[m] ? null : 0)) +
              ' kcal</p><button data-action="save-meal" data-meal="' +
              esc(m) +
              '">Save favourite meal</button>' +
              entries
                .filter((e) => e.meal === m)
                .map(
                  (e) =>
                    "<details><summary>" +
                    esc(e.name) +
                    " · " +
                    e.qty +
                    " " +
                    esc(e.unit) +
                    " · " +
                    value(e.nutrition?.k ?? e.k) +
                    ' kcal</summary><form data-form="edit-log" data-id="' +
                    esc(e.id) +
                    '">' +
                    input("qty", "Quantity", e.qty) +
                    '<button>Update quantity</button></form><button data-action="repeat" data-id="' +
                    esc(e.id) +
                    '">Repeat</button><button data-action="delete" data-id="' +
                    esc(e.id) +
                    '">Delete entry</button></details>',
                )
                .join("") +
              "</article>",
          )
          .join("") +
        '<details><summary>Copy previous meal</summary><form data-form="copy">' +
        input("fromDay", "From day", N.shiftDay(day, -1), "date") +
        mealSelect() +
        "<button>Copy meal</button></form></details>" +
        state.favouriteMeals
          .map(
            (m) =>
              '<button data-action="log-meal" data-id="' +
              esc(m.id) +
              '">Log ' +
              esc(m.name) +
              "</button>",
          )
          .join("") +
        '<form data-form="meal-group">' +
        input("name", "New meal group", "", "text") +
        '<button>Add meal group</button></form><details><summary>Manual calories and macros</summary><form data-form="manual">' +
        input("name", "Entry name", "", "text") +
        mealSelect() +
        nutritionFields({}) +
        "<button>Log manual entry</button></form></details></section>";
      const r = recipeDraft;
      host.innerHTML +=
        "<section><h3>Recipes</h3>" +
        state.recipes
          .map(
            (r) =>
              "<article><h4>" +
              esc(r.name) +
              "</h4><p>" +
              value(r.nutrition.k) +
              " kcal / serving · " +
              r.servings +
              " servings</p><p>" +
              esc(r.assumption) +
              '</p><form data-form="recipe-log" data-id="' +
              esc(r.id) +
              '">' +
              mealSelect() +
              input("qty", "Servings", 1) +
              '<button>Log recipe</button></form><button data-action="edit-recipe" data-id="' +
              esc(r.id) +
              '">Edit recipe</button><button data-action="duplicate-recipe" data-id="' +
              esc(r.id) +
              '">Duplicate recipe</button></article>',
          )
          .join("") +
        '<button data-action="new-recipe">Create recipe</button>' +
        (r
          ? '<form data-form="recipe"><h4>Recipe builder</h4>' +
            input("name", "Recipe name", r.name, "text") +
            input("servings", "Number of servings", r.servings) +
            "<p>Measure ingredients in the state of the saved food. No raw/cooked conversion or cooking yield is assumed.</p><div data-ingredients>" +
            r.ingredients
              .map(
                (i, index) =>
                  "<fieldset><legend>Ingredient " +
                  (index + 1) +
                  '</legend><label>Saved food<select name="foodId">' +
                  state.foods
                    .map(
                      (f) =>
                        "<option " +
                        (f.id === i.foodId ? "selected " : "") +
                        'value="' +
                        esc(f.id) +
                        '">' +
                        esc(f.name) +
                        " (" +
                        esc(f.unit) +
                        "; " +
                        esc(f.preparation) +
                        ")</option>",
                    )
                    .join("") +
                  "</select></label>" +
                  input("qty", "Quantity in food unit", i.qty) +
                  '<button type="button" data-action="remove-ingredient" data-index="' +
                  index +
                  '">Remove ingredient</button></fieldset>',
              )
              .join("") +
            '</div><button type="button" data-action="add-ingredient">Add ingredient</button><button>Save recipe</button><button type="button" data-action="cancel-recipe">Cancel</button></form>'
          : "") +
        "</section>";
      host.innerHTML +=
        "<section><h3>Daily targets</h3><p>Optional and adjustable. Blank means unknown / no target. Training days come from the host schedule. Current day: " +
        (training(day) ? "training" : "rest") +
        '.</p><form data-form="targets"><label>Target schedule<select name="kind">' +
        options(["daily", "training", "rest"]) +
        "</select></label>" +
        nutritionFields(state.targets.daily) +
        '<button>Save targets</button></form></section><section><h3>Product lookup</h3><p>Community-submitted data from <a href="https://world.openfoodfacts.org" target="_blank" rel="noopener">Open Food Facts</a> (<a href="https://opendatacommons.org/licenses/odbl/1-0/">ODbL</a>). Verify against packaging. Correct saved values using Edit food / label. Cached products work offline.</p><form data-form="barcode">' +
        input("barcode", "Manual barcode", "", "text") +
        "<button>Look up product</button></form></section>";
    }
    function draftFromForm() {
      const form = host.querySelector('[data-form="recipe"]');
      if (!form || !recipeDraft) return;
      recipeDraft.name = form.elements.namedItem("name").value;
      recipeDraft.servings = Number(form.elements.namedItem("servings").value);
      recipeDraft.ingredients = [...form.querySelectorAll("fieldset")].map(
        (f) => ({
          foodId: f.querySelector('[name="foodId"]').value,
          qty: Number(f.querySelector('[name="qty"]').value),
        }),
      );
    }
    async function click(event) {
      const b = event.target.closest("[data-action]");
      if (!b || !host.contains(b) || busy) return;
      const a = b.dataset.action,
        id = b.dataset.id;
      try {
        if (a === "previous" || a === "next") {
          day = N.shiftDay(day, a === "previous" ? -1 : 1);
          render();
        } else if (a === "favourite" || a === "delete")
          await commit({ type: a, id });
        else if (a === "edit-food") {
          foodDraft = state.foods.find((f) => f.id === id);
          render();
        } else if (a === "yesterday")
          await copy(state.logs.filter((e) => e.day === N.shiftDay(day, -1)));
        else if (a === "repeat") {
          const e = state.logs.find((e) => e.id === id);
          await commit({
            type: "log",
            entry: Object.assign({}, e, { id: makeId(), day }),
          });
        } else if (a === "undo" && undo) {
          busy = true;
          try {
            await config.onChange(undo, {
              action: { type: "undo" },
              previous: state,
            });
            if (active) {
              state = undo;
              undo = null;
              render();
              announce("Undone");
            }
          } finally {
            busy = false;
          }
        } else if (a === "save-meal")
          await commit({
            type: "save-meal",
            id: makeId(),
            name: b.dataset.meal,
            meal: b.dataset.meal,
            day,
          });
        else if (a === "log-meal")
          await copy(state.favouriteMeals.find((m) => m.id === id).entries);
        else if (a === "new-recipe") {
          recipeDraft = {
            id: makeId(),
            name: "",
            servings: 1,
            ingredients: [],
          };
          render();
        } else if (a === "edit-recipe") {
          recipeDraft = JSON.parse(
            JSON.stringify(state.recipes.find((r) => r.id === id)),
          );
          render();
        } else if (a === "duplicate-recipe")
          await commit({
            type: "recipe",
            recipe: N.duplicateRecipe(
              state.recipes.find((r) => r.id === id),
              makeId(),
            ),
          });
        else if (a === "add-ingredient") {
          draftFromForm();
          recipeDraft.ingredients.push({ foodId: state.foods[0]?.id, qty: 1 });
          render();
        } else if (a === "remove-ingredient") {
          draftFromForm();
          recipeDraft.ingredients.splice(Number(b.dataset.index), 1);
          render();
        } else if (a === "cancel-recipe") {
          recipeDraft = null;
          render();
        }
      } catch (e) {
        announce(e.message, true);
      }
    }
    async function copy(entries) {
      return commit({
        type: "copy",
        entries,
        day,
        ids: entries.map(() => makeId()),
      });
    }
    async function submit(event) {
      const form = event.target.closest("form[data-form]");
      if (!form || !host.contains(form)) return;
      event.preventDefault();
      if (busy) return;
      const data = Object.fromEntries(
          new host.ownerDocument.defaultView.FormData(form),
        ),
        kind = form.dataset.form;
      const numeric = () =>
        Object.fromEntries(
          N.nutrients.map((n) => [n, data[n] === "" ? null : Number(data[n])]),
        );
      try {
        if (kind === "search") {
          query = data.query;
          filter = data.filter;
          category = data.category;
          render();
        } else if (kind === "food") {
          const food = Object.assign(
            {},
            foodDraft || { id: makeId() },
            data,
            numeric(),
            {
              per: Number(data.per),
              custom: true,
              source: foodDraft?.source
                ? "User corrected; original: " + foodDraft.source
                : "user entered",
              verified: false,
            },
          );
          if (await commit({ type: "food", food })) {
            foodDraft = null;
            render();
          }
        } else if (kind === "portion") {
          const food = JSON.parse(
            JSON.stringify(state.foods.find((f) => f.id === data.foodId)),
          );
          N.scalePortion(food, Number(data.qty), data.unit);
          food.portions.push({
            name: data.name,
            qty: Number(data.qty),
            unit: data.unit,
          });
          await commit({ type: "food", food });
        } else if (kind === "log" || kind === "recipe-log") {
          const food =
            kind === "log"
              ? state.foods.find((f) => f.id === form.dataset.id)
              : N.recipeFood(
                  state.recipes.find((r) => r.id === form.dataset.id),
                );
          const portion =
            kind === "log" && data.portion
              ? food.portions.find((p) => p.name === data.portion)
              : null;
          await commit({
            type: "log",
            entry: N.snapshot(
              food,
              portion ? portion.qty : Number(data.qty),
              portion ? portion.unit : food.unit,
              { id: makeId(), day, meal: data.meal },
            ),
          });
        } else if (kind === "manual") {
          await commit({
            type: "log",
            entry: {
              id: makeId(),
              day,
              meal: data.meal,
              name: data.name,
              qty: 1,
              unit: "entry",
              nutrition: numeric(),
              source: "manual entry",
            },
          });
        } else if (kind === "edit-log") {
          const e = JSON.parse(
              JSON.stringify(state.logs.find((e) => e.id === form.dataset.id)),
            ),
            qty = Number(data.qty);
          if (!Number.isFinite(qty) || qty <= 0)
            throw new Error("invalid-quantity");
          const factor = qty / e.qty;
          e.nutrition = Object.fromEntries(
            N.nutrients.map((n) => {
              const v = e.nutrition ? e.nutrition[n] : e[n];
              return [n, v == null ? null : v * factor];
            }),
          );
          e.qty = qty;
          await commit({ type: "edit", id: e.id, entry: e });
        } else if (kind === "copy")
          await copy(
            state.logs.filter(
              (e) => e.day === data.fromDay && e.meal === data.meal,
            ),
          );
        else if (kind === "meal-group")
          await commit({ type: "meal-group", name: data.name });
        else if (kind === "recipe") {
          draftFromForm();
          if (await commit({ type: "recipe", recipe: recipeDraft })) {
            recipeDraft = null;
            render();
          }
        } else if (kind === "targets")
          await commit({
            type: "targets",
            kind: data.kind,
            targets: Object.fromEntries(
              Object.entries(numeric()).filter(([, v]) => v != null),
            ),
          });
        else if (kind === "barcode") {
          busy = true;
          announce("Looking up product…");
          try {
            const result = await N.lookupBarcode(data.barcode, {
              cache: state.productCache,
              online: config.isOnline
                ? config.isOnline()
                : globalThis.navigator?.onLine,
              fetch: config.fetch,
            });
            if (!active) return;
            const corrected = state.foods.find(
              (f) => f.id === result.food.id && f.custom,
            );
            const next = N.transact(state, {
              type: "food",
              food: corrected || result.food,
            }).state;
            const saved = N.transact(next, {
              type: "cache",
              barcode: data.barcode,
              product: result.food,
            }).state;
            await config.onChange(saved, {
              action: { type: "lookup", barcode: data.barcode },
              previous: state,
            });
            if (active) {
              undo = state;
              state = saved;
              render();
              announce(
                corrected
                  ? "Product found; kept your saved label corrections"
                  : result.cached
                    ? "Loaded cached community product; verify label"
                    : "Saved community product; verify label",
              );
            }
          } finally {
            busy = false;
          }
        }
      } catch (e) {
        if (active) announce(e.message, true);
      }
    }
    function change(event) {
      if (event.target.matches("[data-day]")) {
        try {
          N.summary(state, event.target.value);
          day = event.target.value;
          render();
        } catch (e) {
          announce(e.message, true);
        }
      } else if (event.target.matches("[data-complete]"))
        commit({ type: "complete", day, complete: event.target.checked });
      else if (event.target.matches('[name="kind"]')) {
        const form = event.target.form;
        N.nutrients.forEach(
          (n) =>
            (form.elements.namedItem(n).value =
              state.targets[event.target.value][n] ?? ""),
        );
      }
    }
    host.addEventListener("click", click);
    host.addEventListener("submit", submit);
    host.addEventListener("change", change);
    render();
    return {
      getState: () => N.migrate(state),
      update(next) {
        if (busy) throw new Error("persistence-pending");
        state = N.migrate(next);
        undo = null;
        render();
      },
      destroy() {
        active = false;
        host.removeEventListener("click", click);
        host.removeEventListener("submit", submit);
        host.removeEventListener("change", change);
        host.replaceChildren();
        host.classList.remove("vshape-nutrition");
      },
    };
  }
  return { mount, escape: esc };
});
