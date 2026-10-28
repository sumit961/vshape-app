# Agent 2: advanced nutrition and appearance handoff

Implementation location: `C:\Users\xumit\vshape-agent2`.
Committed starting point: `cbfde28fc4442a8d23c0a293566864e993d0b961`.
The primary repository was only read. The five Phase 3A files were copied byte-for-byte before implementation; none were edited in this workspace. **Do not copy those shared files back.** No commit, push, native change or APK publication was performed.

At the final comparison, Agent 1's primary `app.js`, `core.js` and `tests/core.test.js` had moved ahead of these isolated snapshots. They were deliberately not recopied or overwritten. The preserved copied-file SHA256 hashes are:

| File | SHA256 |
| --- | --- |
| `app.js` | `46C8725D6D6F1EC5193B534F615835772CD2EE38BD56A06E8B99E0F436D745CE` |
| `core.js` | `CEA76FEF25FC596A8D23AE2C9054A755CA6220BCAC141A19ECF7AEB3FC05B95E` |
| `style.css` | `DF4D6F775217CB87A90FA1EBF4577C7CCF07C8C57E279DFF4BE52529F245F265` |
| `tests/core.test.js` | `05FF83C4FEABB4164AAFADC8E96BFC5064B2098B3CD2F55838229F3A12B3427C` |
| `tests/smoke.test.js` | `0F20DD4965DDE9CD7D1A3DC43127641C5D83EBFF477FE24906E371274EFDDAFA` |

These are standalone functional modules awaiting Agent 1 integration. They are **not registered in the main app or its Android build**. Existing application tests passing here do not constitute combined application testing.

## Exact copy list

Copy only these new files, keeping their relative paths:

1. `nutrition-advanced.js`: pure calculations, migration, transactions, product lookup; CommonJS + `VShapeNutrition` browser global.
2. `nutrition-ui.js`: functional delegated DOM UI; CommonJS + `VShapeNutritionUI` global.
3. `nutrition.css`: scoped nutrition layout and interaction styles.
4. `theme-manager.js`: validation, callback persistence, contrast correction, live appearance and Settings UI; CommonJS + `VShapeThemes` global.
5. `themes.css`: additive overrides for current app tokens and known hardcoded controls, status and chart elements.
6. `tests/nutrition-advanced.test.js`: deterministic synthetic nutrition and mocked API tests.
7. `tests/nutrition-ui.test.js`: opt-in jsdom integration tests, including Settings UI.
8. `tests/theme-manager.test.js`: deterministic theme persistence, contrast and media listener tests.
9. `docs/agent2-preview.html`: optional runnable module preview, with separate preview-only localStorage keys and no fabricated food library.
10. `docs/AGENT2_HANDOFF.md`: this integration contract.

## Registration and startup

Agent 1 must add stylesheet links **after** `style.css` for `themes.css` and `nutrition.css`. Load plain scripts in this order, before the existing `app.js` startup:

```html
<script src="nutrition-advanced.js"></script>
<script src="nutrition-ui.js"></script>
<script src="theme-manager.js"></script>
```

Add all five production JS/CSS filenames to `scripts/copy-web.js`'s explicit copy list, and to `sw.js`'s precache list. Bump the service worker cache version. The unchanged build currently copies **only the old app**; an ordinary build does not bundle these modules yet.

Apply saved appearance after `loadLocal` / profile defaults, before the first `render`, using `VShapeThemes.watch(document, savedAppearance)`. Keep that watcher for the lifetime of the app; call `.set(prefs)` after successful Settings saves and `.destroy()` on teardown. A Settings-mounted theme UI has its own watcher; dispose it when the sheet closes. The lifetime watcher still needs the saved values so closing Settings does not leave it observing stale preferences.

## State and migration

Recommended additive fields: `S.profile.nutritionAdvanced` and `S.profile.appearance`. Do not replace `S.profile`, `.fitness`, `.weights`, `.targets`, or `S.days` wholesale. Nutrition state v1 is:

```js
{
  version: 1,
  foods: [], recipes: [], logs: [],
  favourites: [], recent: [], favouriteMeals: [],
  mealGroups: ['Breakfast', 'Lunch', 'Dinner', 'Snacks'],
  targets: { daily: {}, training: {}, rest: {} },
  completeDays: [], productCache: {}
}
```

Foods retain the app's `{id,name,unit,per,def,k,p,c,f}` fields. Optional metadata: `brand`, `barcode`, `category`, `custom`, `source`, `sourceUrl`, `verified`, `preparation`, `gramsPerServing`, `portions:[{name,qty,unit}]`. `per` is the amount of `unit` for the nutrition values: 100 g, 100 ml or a serving/count amount. New nutrients are `fibre`, `sugar` (grams), `sodium` (**milligrams**). Every unavailable nutrient is `null`, never a guessed zero. Zero is valid only if explicitly supplied.

Import once after the existing app has completed its own schema migration:

```js
const nutrition = VShapeNutrition.migrate(S.profile.nutritionAdvanced, {
  foods: FOODS.concat(
    (S.profile.customFoods || []).map((f) => ({ ...f, custom: true })),
  ),
  days: S.days,
  targets: S.profile.targets,
});
```

Pass `undefined`/`null` saved state for the initial migration; passing `defaults()` deliberately counts as existing targets. Existing daily kcal/protein targets are imported only if no advanced `targets` exist. Legacy logs retain their full values and metadata; IDs become `legacy:YYYY-MM-DD:originalId`, with `legacyId` recorded. Existing `Snack`, `Post-gym`, and other meal names are retained and added to meal groups. No spelling-based merging occurs. Legacy source remains unspecified; no provenance is invented.

`migrate` returns a cloned, validated state. It rejects invalid/duplicate IDs, invalid dates, malformed arrays, negative/nonfinite nutrition, unsupported versions, broken recipes and invalid cached products with explicit thrown errors. A rejected restore must retain the prior saved state and offer a recovery path; do not catch and replace with empty defaults. ID collisions within a collection are errors. Food IDs can intentionally equal recipe IDs in their different collections. Re-importing matching legacy log IDs is idempotent and keeps advanced edits. Explicitly import any newer host-side logs if the old Food screen remains enabled.

Recipes store ingredient nutrition snapshots and per-serving results. Logs contain independent `{nutrition:{k,p,c,f,fibre,sugar,sodium}}` snapshots. Editing a food/recipe never changes a logged snapshot. Recipe edits deliberately recalculate from currently saved foods. Measurement preparation remains explicit; the app's existing food names containing "cooked" are preserved but preparation is not inferred from free text. Agent 1 may annotate the known built-in foods explicitly after verifying them.

## Nutrition engine public API

All functions throw `Error(code)` for invalid input unless otherwise stated. All data functions return new objects; callers should treat results as immutable.

| API                                            | Contract                                                                                                                                                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `nutrients`                                    | Nutrient key list, `k,p,c,f,fibre,sugar,sodium`.                                                                                                                                                                         |
| `defaults()`                                   | Fresh state; no fabricated foods/targets.                                                                                                                                                                                |
| `migrate(saved, legacy?)`                      | Validate, clone and add defaults; optional compatible legacy import. JSON round-trips supported.                                                                                                                         |
| `normalizeFood(food)`                          | Preserve extra metadata, validate ID/name/serving/nutrients, add explicit nulls.                                                                                                                                         |
| `scalePortion(food, qty, unit?, preparation?)` | Nutrition for positive fractional quantity; g/kg/oz and ml/l conversions; optional explicit `gramsPerServing` for g-based foods. Same-unit counts supported. No inferred mass/volume, cup/gram or raw/cooked conversion. |
| `totals(entries)`                              | Summed nutrients or null when any entry lacks that nutrient; `known` subtotal and `missing` count. Accepts nested nutrition or legacy flat entries.                                                                      |
| `search(state, query, filter?)`                | Name/brand/barcode substring; filters `category`, `custom`, `favourites`, `recent`. Recent results use most-recent-first order.                                                                                          |
| `snapshot(food, qty, unit, {id,day,meal,...})` | Independent logged nutrition and food provenance.                                                                                                                                                                        |
| `createRecipe(input, foods)`                   | Input `{id,name,servings,ingredients:[{foodId,qty,unit?,preparation?}]}`. Returns ingredient snapshots, total/serving nutrition, and explicit yield assumption. Also used for edits.                                     |
| `recipeFood(recipe)`                           | Serving-based food adapter for logging recipes.                                                                                                                                                                          |
| `duplicateRecipe(recipe, newId)`               | Deep copy with distinct ID; save through recipe transaction.                                                                                                                                                             |
| `targetsFor(state, trainingBoolean)`           | Daily targets overlaid by explicit training/rest overrides; unspecified override keys inherit.                                                                                                                           |
| `summary(state, day, training?)`               | Daily totals, per-nutrient progress, remaining kcal, completion flag and meal summaries. Remaining/progress are null for missing data or no applicable target.                                                           |
| `weekly(state, endDay, trainingDays?)`         | Seven daily summaries; per-nutrient averages with denominators; calorie adherence ratios for confirmed days only. No-entry days are not assumed to be fasting.                                                           |
| `weightTrend(weightsMap, start?, end?)`        | Recorded points, mean and first-to-last change; kg input. No interpolated measurements.                                                                                                                                  |
| `estimate(profile, kcalPerKg)`                 | Optional weight × explicitly user-selected factor estimate with assumptions; never sets targets or infers physiological sex from gender.                                                                                 |
| `shiftDay(day, offset)`                        | Calendar arithmetic using explicit ISO dates, independent of UTC day-boundary shifts.                                                                                                                                    |
| `transact(state, action)`                      | Validated `{state,undo}`; host persists `.state`, and may restore `.undo`.                                                                                                                                               |
| `lookupBarcode(code, options?)`                | Promise `{food,cached,offline?,stale?,error?}`; described below.                                                                                                                                                         |

Supported `transact` actions:

```js
{type:'food',food} // upsert; snapshots remain unchanged
{type:'log',entry}
{type:'edit',id,entry} // entry retains same id; caller supplies updated snapshot
{type:'delete',id}
{type:'favourite',id} // toggle
{type:'recipe',recipe} // create or update, recalculating ingredient nutrition
{type:'save-meal',id,name,day,meal} // snapshots of current matching meal
{type:'copy',fromDay,meal?,day,ids,toMeal?} // one fresh id per selected log
{type:'copy',entries,day,ids,toMeal?} // favourite or arbitrary previous entries
{type:'targets',kind:'daily' /* or training/rest */,targets:{k,p,c,f,fibre}}
{type:'complete',day,complete:true}
{type:'meal-group',name}
{type:'cache',barcode,product:food}
```

Stable IDs are host-supplied; the UI defaults to `crypto.randomUUID()`. Supply the existing `uid` function where secure-context UUIDs are unavailable. Calories can exceed budget; negative remaining calories are a valid display value. Adherence means consumed/target, not a claim that restriction or a precise ratio is desirable. Weekly nutrient averages require both an explicitly completed day and known values for that nutrient.

## Food screen and persistence wiring

The host must supply a real **durable** persistence callback. The module does not write localStorage, IndexedDB or original app keys. It holds an isolated proposed state and only accepts it after `onChange` resolves; rejections show an accessible error and keep the old state. No optimistic success before storage succeeds. Mutations are serialized within a mounted module. The host must serialize across mounts and old app actions as well.

```js
const mountedFood = VShapeNutritionUI.mount(foodContainer, {
  state: nutrition,
  day: ui.date,
  makeId: uid,
  weights: S.profile.weights,
  trainingDays: resolvedTrainingIsoDates, // host resolves schedule + date overrides
  isOnline: () => navigator.onLine,
  fetch: identifiedProductFetch, // optional native/proxy adapter; see below
  onChange: async (next, { action, previous }) => {
    // Agent 1 supplies this transaction: stage a cloned app state, preserve
    // other domains, reconcile food records/targets, persist durably,
    // then publish it to S. Reject on failure; avoid mutating S first.
    await commitNutritionToExistingApp(next, previous, action);
  },
});
// Before render() replaces the Food host or changes date/tab:
mountedFood.destroy();
// External restore/host changes while mounted and idle:
mountedFood.update(reloadedNutrition); // validates, clears undo
// mountedFood.getState() returns a validated clone.
```

`commitNutritionToExistingApp` and `resolvedTrainingIsoDates` above are deliberately named **host integration work**, not shipped functions. `saveProfile()` and `saveDay()` currently enqueue writes and return no durable promise; wrapping their return values in `await` is insufficient. Connect to the actual successful flush/transaction path and storage failure handling. Use a revision check if external app state changes while a callback is in flight. Callbacks receive proposed mutable objects; persist/copy them rather than modifying them.

Choose one authoritative log source. Recommended: advanced state is authoritative for nutrition after migration; project it into the legacy food shape for compatibility. For each advanced log, produce a day entry with the original legacy ID (`legacyId || id`), existing metadata, and flat nutrient values copied from `nutrition`. Update existing day `.food` arrays without changing steps, sessions, water, photos, date overrides or quarantine. Diff previous/new advanced logs by stable ID to identify adds/edits/deletes, including undo. Do **not** append every advanced log to legacy logs on each render, and do not blindly re-import deleted stale records. If keeping the old quick-add path, route it through the same authoritative transaction or reconcile it explicitly before mounting.

The old `app.js` `totals`, `foodRow`, dashboard/macro views and `core.js` `sanitizeMacroEntry` assume all four macros exist. **Agent 1 must teach these readers about missing nutrients before projecting new records with null fields.** In particular `Number(null)` in the old sanitizer converts unknowns into zero. Use `VShapeNutrition.totals` and its completeness metadata, or update host readers equivalently. Avoid falling back from explicit `null` to stale legacy numbers. Mirror daily k/p targets to `profile.targets.kcal/protein` only when explicitly supplied, preserving steps/water and every other target. Day-specific training/rest targets should be resolved for dashboard displays too. Never fabricate missing carbs/fat to satisfy the old sanitizer.

The nutrition UI includes saved/recent/favourite/custom/category search, editable food metadata/nutrition, reusable portions, fractional logging, quantity edits, deletion, one-step undo, repeat, yesterday/previous meal copying, favourite meals, custom meal groups, manual entries, recipe creation/edit/duplicate/logging, targets, explicit day completion, daily/weekly analytics and manual barcode lookup. Logs preserve immutable recipe nutrition. Historical day navigation uses explicit date keys. A reused portion replaces the entered amount with its saved quantity/unit. An edit to a log's quantity rescales its historical snapshot, using no current recipe values.

## Appearance public API and Settings integration

`defaults()`, `normalize(raw)`, `load(asyncRead)`, `save(prefs,asyncWrite)`, `apply(document,prefs,{dark,reduced}?)`, `watch(document,prefs,matchMedia?)`, `mount(container,options)`, `contrast(hex,hex)`, `readable(accent,background)`, and `accents` are exported.

Preferences: `{mode:'default'|'dark'|'light'|'system', accent:'orange'|'cyan'|'green'|'purple'|'red'|'custom', customAccent:'#RRGGBB', density:'comfortable'|'compact', motion:'system'|'reduced'}`. Invalid preferences fall back field-by-field; no arbitrary CSS strings are applied. `load` recovers from read failure to defaults, `save` propagates write failure. Theme persistence is entirely via callbacks. Theme functions have no nutrition/workout dependencies.

```js
const themeSettings = VShapeThemes.mount(settingsAppearanceHost, {
  preferences: S.profile.appearance,
  onSave: async (prefs) => {
    await persistAppearanceDurably(prefs); // preserve all other profile fields
    appThemeWatcher.set(prefs);
  },
});
// Settings close / sheet rerender:
themeSettings.destroy();
```

`watch` returns `{set,destroy}`; `mount` returns `{destroy}`. Default mode inherits the original app's warm background/type/surfaces; accent text and button colors are adjusted for contrast. Dark/light/system and density changes apply immediately after successful persistence. Accent backgrounds use black/white foreground selected for >=4.5:1 contrast, with a separate adjusted text accent for each background. Filled controls and the known workout timer/navigation/chips are covered. Reduced-motion preference disables CSS motion and follows the system; it does not stop workout timing. Native Android notification styling is untouched. Verify remaining Agent 1-added components and actual Android display contrast during integration; tests cover token contrast and DOM behavior, not every rendered pixel. Dashboard arrangement, hidden sections, number-format and unit-display preferences are outside this implementation.

## Barcode lookup foundation

Manual 8–14 digit barcode input only; no native camera/plugin changes. `lookupBarcode` options: `{cache,online,refresh,fetch,signal}`. Cache-first (no expiry); `refresh:true` requests a network refresh. Offline cache miss gives `offline-cache-miss`. A failed refresh may return stale cached data with the error. Returned products do not mutate a cache themselves; use a cache transaction or persist alongside the added food. UI product lookup performs a single host save for food + cache. Corrected saved foods remain independent of the original community cache; no correction is uploaded.

The GET uses Open Food Facts v3, requests only needed fields, has a ten-second abort timeout when supported, and uses no search-as-you-type network requests. A shared in-memory limiter allows at most 12 network attempts/minute per JS context, including failed attempts. It does not coordinate across devices/tabs; the host/native adapter must honor HTTP 429/Retry-After and shared-IP limits. There are no automatic retry loops. `online` is a hint; requests can still fail and cache fallback remains available. `fetch` injection supports native networking or a controlled proxy; the adapter must preserve abort behavior if needed.

The implementation requests `User-Agent: VShape/1.0 (https://github.com/sumit961/vshape-app)`. Browser/WebView fetch implementations can strip/override that header. Agent 1 must verify the emitted identification header in the final WebView, or provide a native/proxy fetch adapter before enabling production lookup. No live production product lookup was performed during tests (all responses are synthetic mocks).

Only numeric nonnegative nutrient fields actually returned by the source are used. Sodium g is converted to mg. Products without an explicit supported mass/volume basis (`product_quantity_unit` g or ml) fail with `product-basis-unknown`, inviting manual label entry. This is conservative and excludes some valid products until explicit basis resolution is added; no unit is guessed from the product name or package text. API community values always carry `verified:false` and visible attribution. A local user correction changes source to user-corrected; the module never asserts that a label was independently verified.

Before production enablement, follow the [official API usage guidance](https://openfoodfacts.github.io/openfoodfacts-server/api/), including identification, usage registration, attribution and current rate limits. Database attribution is ODbL, individual contents DbCL; the UI retains source links and does not fetch images. Preserve provenance/license fields in exports and review source-license requirements when distributing derived datasets. Camera scanning remains Agent 1/native work: review a suitable Capacitor plugin, add camera permissions with a user-triggered flow, validate the returned barcode, and call this same lookup. Manual entry and all local nutrition functions must continue working without camera/network access.

## Backup / restore

Include complete `profile.nutritionAdvanced` and `profile.appearance` in JSON backup, alongside all existing domains. `migrate(JSON.parse(JSON.stringify(state)))` is the nutrition round-trip path; `normalize(appearance)` is the theme restore path. Validate **before** replacing live state, persist through the same durable host transaction, then update/destroy/remount views and call the lifetime theme watcher `.set()`. Unsupported nutrition versions should be quarantined/rejected without clearing the original backup. Preserve source metadata, ingredient/log snapshots, null nutrient values, product cache, recent/favourite IDs, meal groups and completed-day flags. Existing photos/Health Connect/session handling remains owned by Agent 1.

## Validation and preview

No new production dependencies. Node engine and theme tests run with:

```powershell
node --test tests/nutrition-advanced.test.js tests/theme-manager.test.js
```

DOM tests are opt-in so the existing dependency manifest remains untouched. For this workspace they were actually executed using jsdom installed outside both repositories:

Module suite result: **23 passed, zero failed, zero skipped**, including actual DOM interaction tests. The final full `npm.cmd run validate` passed **154 tests, zero failed, zero skipped**, plus syntax checks and the legacy build. This includes the four additional restore/correction/unmount/failure regression cases. Each new JavaScript module was additionally checked with `node --check`.

```powershell
npm.cmd install --prefix "$env:TEMP\vshape-agent2-test" jsdom --no-save --no-package-lock
$env:NODE_PATH="$env:TEMP\vshape-agent2-test\node_modules"
$env:VSHAPE_DOM_TESTS='1'
node --test tests/nutrition-advanced.test.js tests/theme-manager.test.js tests/nutrition-ui.test.js
npm.cmd run validate
```

Without `VSHAPE_DOM_TESTS=1`, the DOM cases explicitly skip. With it set, a missing jsdom installation fails visibly. Fixtures are clearly synthetic and never installed into the app's actual food database.

For a manual isolated preview, serve this workspace over localhost (`npx.cmd http-server -p 8082 -c-1 .`) and open `/docs/agent2-preview.html`. Its host callbacks persist only to `vshape-agent2-preview-v1` and `vshape-agent2-preview-v1-theme`; it neither imports nor changes main application records. Preview starts empty. This preview was DOM-tested through the modules, not visually certified on Android.

Agent 1 still owns final script/CSS/build/cache registration, authoritative host persistence, legacy-reader null handling, backup registration/restore, date/schedule/profile mapping, final Settings/Food entry points, production network identification, native camera review, combined app testing and APK build/publication. Copy only the ten new files listed above; leave all copied shared Phase 3A files and generated `www` files behind.
