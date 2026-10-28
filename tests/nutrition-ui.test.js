"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const N = require("../nutrition-advanced"),
  UI = require("../nutrition-ui"),
  T = require("../theme-manager");
// DOM integration suite is opt-in; see handoff for isolated jsdom setup.
const domTest = process.env.VSHAPE_DOM_TESTS === "1" ? test : test.skip;
function setup(config = {}) {
  const { JSDOM } = require("jsdom");
  const dom = new JSDOM('<!doctype html><div id="host"></div>');
  const host = dom.window.document.getElementById("host");
  let counter = 0;
  const mounted = UI.mount(host, {
    day: "2026-10-21",
    makeId: () => "new-" + ++counter,
    onChange: async () => {},
    ...config,
  });
  return { dom, host, mounted };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
function submit(host, formName, values) {
  const form = host.querySelector('[data-form="' + formName + '"]');
  for (const [k, v] of Object.entries(values || {}))
    form.elements.namedItem(k).value = v;
  form.dispatchEvent(
    new host.ownerDocument.defaultView.Event("submit", {
      bubbles: true,
      cancelable: true,
    }),
  );
}
domTest(
  "real DOM: an in-flight save cannot remount a destroyed food UI",
  async () => {
    let resolveSave;
    const { host, mounted } = setup({
      onChange: () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    });
    submit(host, "food", { name: "Pending fixture", k: 100 });
    mounted.destroy();
    resolveSave();
    await settle();
    assert.equal(host.children.length, 0);
  },
);
domTest(
  "real DOM: cached lookup preserves user label corrections",
  async () => {
    const cached = {
      id: "off:12345678",
      name: "Community fixture",
      unit: "g",
      per: 100,
      k: 10,
    };
    const corrected = {
      ...cached,
      name: "User correction",
      custom: true,
      k: 20,
    };
    const { host, mounted } = setup({
      state: N.migrate({
        foods: [corrected],
        productCache: { 12345678: cached },
      }),
      isOnline: () => false,
    });
    submit(host, "barcode", { barcode: "12345678" });
    await settle();
    assert.equal(mounted.getState().foods[0].k, 20);
    assert.equal(mounted.getState().productCache["12345678"].k, 10);
  },
);
domTest(
  "real DOM: theme save failure retains applied appearance and re-enables controls",
  async () => {
    const { JSDOM } = require("jsdom"),
      dom = new JSDOM('<div id="host"></div>'),
      host = dom.window.document.getElementById("host");
    const m = T.mount(host, {
      onSave: async () => {
        throw Error("disk full");
      },
    });
    const select = host.querySelector('[name="mode"]');
    select.value = "dark";
    select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await settle();
    assert.equal(
      dom.window.document.documentElement.dataset.vshapeTheme,
      "default",
    );
    assert.equal(select.value, "default");
    assert.equal(select.disabled, false);
    assert.match(host.textContent, /disk full/);
    m.destroy();
  },
);
domTest(
  "real DOM: labelled controls, unknown status, escaped names and listener cleanup",
  () => {
    const f = {
      id: "x",
      name: "<img src=x onerror=alert(1)>",
      unit: "g",
      per: 100,
      k: 10,
    };
    const { host, mounted } = setup({ state: N.migrate({ foods: [f] }) });
    assert.equal(host.querySelector("img"), null);
    assert.match(host.textContent, /Unknown/);
    assert.equal(
      host.querySelector("[data-status]").getAttribute("aria-live"),
      "polite",
    );
    for (const el of host.querySelectorAll("input,select"))
      assert.ok(el.closest("label"), "input has label");
    assert.equal(
      host
        .querySelector('[data-action="favourite"]')
        .getAttribute("aria-pressed"),
      "false",
    );
    mounted.destroy();
    assert.equal(host.children.length, 0);
  },
);
domTest(
  "real DOM: logging fractional quantities, editing, repeat, delete and undo persist through callback",
  async () => {
    let saved;
    const { host, mounted } = setup({
      state: N.migrate({
        foods: [
          { id: "food", name: "Test fixture", per: 100, unit: "g", k: 200 },
        ],
      }),
      onChange: async (s) => (saved = JSON.parse(JSON.stringify(s))),
    });
    submit(host, "log", { qty: "12.5" });
    await settle();
    assert.equal(saved.logs[0].nutrition.k, 25);
    submit(host, "edit-log", { qty: "25" });
    await settle();
    assert.equal(saved.logs[0].nutrition.k, 50);
    host.querySelector('[data-action="repeat"]').click();
    await settle();
    assert.equal(saved.logs.length, 2);
    host.querySelector('[data-action="delete"]').click();
    await settle();
    assert.equal(saved.logs.length, 1);
    host.querySelector('[data-action="undo"]').click();
    await settle();
    assert.equal(saved.logs.length, 2);
    assert.equal(mounted.getState().logs.length, 2);
  },
);
domTest(
  "real DOM: recipe builder calculates servings and edits preserve historical log",
  async () => {
    const { host, mounted } = setup({
      state: N.migrate({
        foods: [
          {
            id: "f",
            name: "Synthetic ingredient",
            per: 100,
            unit: "g",
            k: 200,
          },
        ],
      }),
    });
    host.querySelector('[data-action="new-recipe"]').click();
    host.querySelector('[data-action="add-ingredient"]').click();
    submit(host, "recipe", { name: "Recipe fixture", servings: 2, qty: 100 });
    await settle();
    assert.equal(mounted.getState().recipes[0].nutrition.k, 100);
    submit(host, "recipe-log", { qty: 1 });
    await settle();
    host.querySelector('[data-action="edit-recipe"]').click();
    submit(host, "recipe", { servings: 1 });
    await settle();
    assert.equal(mounted.getState().recipes[0].nutrition.k, 200);
    assert.equal(mounted.getState().logs[0].nutrition.k, 100);
  },
);
domTest(
  "real DOM: failed persistence leaves state intact and announces accessible error",
  async () => {
    const { host, mounted } = setup({
      onChange: async () => {
        throw Error("disk full");
      },
    });
    submit(host, "manual", { name: "Test", k: 100 });
    await settle();
    assert.equal(mounted.getState().logs.length, 0);
    assert.equal(
      host.querySelector("[data-status]").getAttribute("role"),
      "alert",
    );
    assert.match(host.querySelector("[data-status]").textContent, /disk full/);
  },
);
domTest(
  "real DOM: offline product cache lookup persists product without network",
  async () => {
    const f = {
      id: "off:12345678",
      name: "Cached fixture",
      per: 100,
      unit: "g",
      k: 10,
    };
    const { host, mounted } = setup({
      state: N.migrate({ productCache: { 12345678: f } }),
      isOnline: () => false,
      fetch: () => {
        throw Error("unexpected network");
      },
    });
    submit(host, "barcode", { barcode: "12345678" });
    await settle();
    assert.equal(mounted.getState().foods[0].id, f.id);
    assert.match(host.querySelector("[data-status]").textContent, /cached/);
  },
);
domTest(
  "real DOM: theme controls persist, apply, restore defaults and unmount",
  async () => {
    const { JSDOM } = require("jsdom");
    const dom = new JSDOM('<!doctype html><div id="host"></div>'),
      host = dom.window.document.getElementById("host");
    let saved;
    const m = T.mount(host, { onSave: async (p) => (saved = p) });
    const select = host.querySelector('[name="mode"]');
    select.value = "dark";
    select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await settle();
    assert.equal(saved.mode, "dark");
    assert.equal(
      dom.window.document.documentElement.dataset.vshapeTheme,
      "dark",
    );
    host.querySelector("button").click();
    await settle();
    assert.equal(saved.mode, "default");
    m.destroy();
    assert.equal(host.children.length, 0);
  },
);
