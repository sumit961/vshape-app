(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.VShapeThemes = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const accents = {
    orange: "#F26A0F",
    cyan: "#22D3EE",
    green: "#22C55E",
    purple: "#A78BFA",
    red: "#EF4444",
  };
  const defaults = () => ({
    mode: "default",
    accent: "orange",
    customAccent: "#F26A0F",
    density: "comfortable",
    motion: "system",
  });
  function normalize(raw) {
    const p = Object.assign(defaults(), raw || {});
    if (!["default", "dark", "light", "system"].includes(p.mode))
      p.mode = "default";
    if (!Object.hasOwn(accents, p.accent) && p.accent !== "custom")
      p.accent = "orange";
    if (!/^#[\da-f]{6}$/i.test(p.customAccent)) p.customAccent = "#F26A0F";
    if (!["compact", "comfortable"].includes(p.density))
      p.density = "comfortable";
    if (!["system", "reduced"].includes(p.motion)) p.motion = "system";
    return p;
  }
  function luminance(hex) {
    const c = hex
      .slice(1)
      .match(/../g)
      .map((x) => parseInt(x, 16) / 255)
      .map((x) =>
        x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4),
      );
    return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
  }
  function contrast(a, b) {
    const x = luminance(a),
      y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  function readable(accent, bg) {
    if (contrast(accent, bg) >= 4.5) return accent;
    const end = luminance(bg) > 0.5 ? "#000000" : "#FFFFFF";
    let c = accent;
    for (let i = 1; i <= 100; i++) {
      c =
        "#" +
        [1, 3, 5]
          .map((pos) =>
            Math.round(
              parseInt(accent.slice(pos, pos + 2), 16) * (1 - i / 100) +
                (parseInt(end.slice(pos, pos + 2), 16) * i) / 100,
            )
              .toString(16)
              .padStart(2, "0"),
          )
          .join("");
      if (contrast(c, bg) >= 4.5) return c;
    }
    return end;
  }
  async function load(read) {
    try {
      return normalize(await read());
    } catch (_) {
      return defaults();
    }
  }
  async function save(raw, write) {
    const prefs = normalize(raw);
    await write(prefs);
    return prefs;
  }
  function apply(document, raw, env) {
    env = env || {};
    const prefs = normalize(raw),
      el = document.documentElement;
    const dark = prefs.mode === "dark" || (prefs.mode === "system" && env.dark);
    const mode = prefs.mode === "default" ? "default" : dark ? "dark" : "light";
    el.dataset.vshapeTheme = mode;
    el.dataset.vshapeDensity = prefs.density;
    el.dataset.vshapeMotion =
      prefs.motion === "reduced" || env.reduced ? "reduced" : "full";
    const color =
        prefs.accent === "custom" ? prefs.customAccent : accents[prefs.accent],
      bg = dark ? "#10151C" : mode === "default" ? "#FFF6EE" : "#F5F7FA";
    const ink =
      contrast("#000000", color) >= contrast("#FFFFFF", color)
        ? "#000000"
        : "#FFFFFF";
    const text = readable(color, bg);
    const cta = readable(color, bg);
    const ctaInk =
      contrast("#000000", cta) >= contrast("#FFFFFF", cta)
        ? "#000000"
        : "#FFFFFF";
    Object.entries({
      "--accent": color,
      "--accent-text": text,
      "--accent-ink": ctaInk,
      "--accent-grad": "linear-gradient(" + cta + "," + cta + ")",
      "--accent-soft": color + "24",
      "--theme-accent-fill-ink": ink,
    }).forEach(([k, v]) => el.style.setProperty(k, v));
    return prefs;
  }
  function watch(document, raw, matchMedia) {
    const media =
      matchMedia ||
      document.defaultView?.matchMedia?.bind(document.defaultView);
    let prefs = normalize(raw);
    const dark = media?.("(prefers-color-scheme: dark)"),
      reduced = media?.("(prefers-reduced-motion: reduce)");
    const update = () =>
      apply(document, prefs, {
        dark: !!dark?.matches,
        reduced: !!reduced?.matches,
      });
    [dark, reduced].forEach((m) => m?.addEventListener("change", update));
    update();
    return {
      set(p) {
        prefs = normalize(p);
        update();
      },
      destroy() {
        [dark, reduced].forEach((m) =>
          m?.removeEventListener("change", update),
        );
      },
    };
  }
  function mount(container, options) {
    const d = container.ownerDocument;
    let prefs = normalize(options.preferences);
    const watcher = watch(d, prefs, options.matchMedia);
    let active = true;
    const fields = [
      ["mode", "Appearance", ["default", "light", "dark", "system"]],
      ["accent", "Accent", [...Object.keys(accents), "custom"]],
      ["density", "Density", ["comfortable", "compact"]],
      ["motion", "Motion", ["system", "reduced"]],
    ];
    container.replaceChildren();
    const form = d.createElement("form");
    form.className = "vshape-theme-settings";
    fields.forEach(([name, label, values]) => {
      const l = d.createElement("label");
      l.textContent = label;
      const s = d.createElement("select");
      s.name = name;
      values.forEach((value) => {
        const o = d.createElement("option");
        o.value = value;
        o.textContent = value;
        o.selected = prefs[name] === value;
        s.append(o);
      });
      l.append(s);
      form.append(l);
    });
    const label = d.createElement("label");
    label.textContent = "Custom accent";
    const color = d.createElement("input");
    color.type = "color";
    color.name = "customAccent";
    color.value = prefs.customAccent;
    label.append(color);
    form.append(label);
    const reset = d.createElement("button");
    reset.type = "button";
    reset.textContent = "Restore default appearance";
    form.append(reset);
    const status = d.createElement("p");
    status.setAttribute("role", "status");
    form.append(status);
    container.append(form);
    let pending = false;
    async function change() {
      if (pending) return;
      pending = true;
      const previous = prefs;
      const candidate = Object.fromEntries(
        [...form.elements].filter((e) => e.name).map((e) => [e.name, e.value]),
      );
      for (const el of form.elements) el.disabled = true;
      try {
        prefs = await save(candidate, options.onSave);
        if (active) {
          watcher.set(prefs);
          status.textContent = "Appearance saved";
        }
      } catch (e) {
        prefs = previous;
        if (active) {
          for (const el of form.elements)
            if (el.name) el.value = prefs[el.name];
          status.textContent = "Could not save appearance: " + e.message;
        }
      } finally {
        pending = false;
        if (active) for (const el of form.elements) el.disabled = false;
      }
    }
    function restore() {
      if (pending) return;
      for (const el of form.elements)
        if (el.name) el.value = defaults()[el.name];
      return change();
    }
    form.addEventListener("change", change);
    reset.addEventListener("click", restore);
    return {
      destroy() {
        active = false;
        watcher.destroy();
        form.removeEventListener("change", change);
        reset.removeEventListener("click", restore);
        container.replaceChildren();
      },
    };
  }
  return {
    accents,
    defaults,
    normalize,
    contrast,
    readable,
    load,
    save,
    apply,
    watch,
    mount,
  };
});
