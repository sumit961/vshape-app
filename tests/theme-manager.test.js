"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const T = require("../theme-manager");
function doc() {
  const styles = {};
  return {
    documentElement: {
      dataset: {},
      style: {
        setProperty(k, v) {
          styles[k] = v;
        },
      },
    },
    styles,
  };
}
test("theme preferences save/load and sanitize invalid values without touching other state", async () => {
  let stored;
  const prefs = {
    mode: "dark",
    accent: "custom",
    customAccent: "#123456",
    density: "compact",
    motion: "reduced",
  };
  await T.save(prefs, async (p) => (stored = JSON.stringify(p)));
  assert.deepEqual(await T.load(async () => JSON.parse(stored)), prefs);
  assert.deepEqual(
    await T.load(async () => {
      throw Error("storage");
    }),
    T.defaults(),
  );
  const p = T.normalize({
    mode: "bad",
    accent: "constructor",
    customAccent: "red",
    density: "bad",
    motion: "bad",
  });
  assert.deepEqual(p, T.defaults());
});
test("all accent foregrounds and accent text meet WCAG 4.5 contrast for every appearance", () => {
  for (const mode of ["default", "light", "dark"])
    for (const color of [
      ...Object.values(T.accents),
      "#FFFFFF",
      "#000000",
      "#888888",
    ]) {
      const d = doc();
      T.apply(d, { mode, accent: "custom", customAccent: color });
      const bg =
        mode === "dark"
          ? "#10151C"
          : mode === "default"
            ? "#FFF6EE"
            : "#F5F7FA";
      assert.ok(T.contrast(d.styles["--accent-text"], bg) >= 4.5);
      const cta = d.styles["--accent-grad"].match(/#[0-9a-f]{6}/i)[0];
      assert.ok(T.contrast(d.styles["--accent-ink"], cta) >= 4.5);
    }
});
test("system changes and reduced motion apply instantly and listeners clean up", () => {
  const media = {};
  const match = (q) =>
    media[q] ||
    (media[q] = {
      matches: false,
      listeners: new Set(),
      addEventListener(_, fn) {
        this.listeners.add(fn);
      },
      removeEventListener(_, fn) {
        this.listeners.delete(fn);
      },
    });
  const d = doc(),
    w = T.watch(d, { mode: "system" }, match);
  assert.equal(d.documentElement.dataset.vshapeTheme, "light");
  media["(prefers-color-scheme: dark)"].matches = true;
  media["(prefers-color-scheme: dark)"].listeners.forEach((f) => f());
  assert.equal(d.documentElement.dataset.vshapeTheme, "dark");
  w.set({ mode: "light", motion: "reduced" });
  assert.equal(d.documentElement.dataset.vshapeMotion, "reduced");
  w.destroy();
  assert.equal(media["(prefers-color-scheme: dark)"].listeners.size, 0);
});
