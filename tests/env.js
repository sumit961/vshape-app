'use strict';
/* Minimal fake browser environment so the real app.js can be loaded and
   booted under Node's vm module, without adding a jsdom dependency. It only
   implements what app.js actually touches at startup: a handful of elements
   looked up by id, localStorage, a tiny IndexedDB, and the event registration
   surface. It is not a general-purpose DOM. */
const vm = require('node:vm');

function makeLocalStorage() {
  const map = new Map();
  return {
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
    key(i) { return Array.from(map.keys())[i]; },
    get length() { return map.size; },
    _dump() { return new Map(map); }
  };
}

function makeElement(id) {
  let html = '';
  return {
    id: id,
    hidden: true,
    className: '',
    textContent: '',
    value: '',
    dataset: {},
    disabled: false,
    get innerHTML() { return html; },
    set innerHTML(v) { html = v; },
    appendChild() {},
    remove() {},
    click() {},
    addEventListener() {},
    querySelector() { return null; },
    closest() { return null; },
  };
}

function makeFakeIndexedDB() {
  const databases = new Map();
  function open(name, version) {
    const req = { result: null, onupgradeneeded: null, onsuccess: null, onerror: null, error: null };
    setTimeout(() => {
      let rec = databases.get(name);
      const isNew = !rec;
      if (!rec) { rec = { version: 0, stores: new Map(), keyPaths: new Map() }; databases.set(name, rec); }
      const needsUpgrade = isNew || rec.version < version;
      const db = makeDbHandle(rec);
      req.result = db;
      if (needsUpgrade) {
        const oldVersion = rec.version;
        rec.version = version;
        if (req.onupgradeneeded) req.onupgradeneeded({ oldVersion: oldVersion, newVersion: version, target: req });
      }
      if (req.onsuccess) req.onsuccess({ target: req });
    }, 0);
    return req;
  }
  function makeDbHandle(rec) {
    return {
      get objectStoreNames() { return { contains: (n) => rec.stores.has(n) }; },
      createObjectStore(storeName, opts) {
        rec.stores.set(storeName, new Map());
        rec.keyPaths.set(storeName, (opts && opts.keyPath) || 'id');
        return { createIndex() {} };
      },
      transaction(storeNames) {
        const tx = { oncomplete: null, onerror: null };
        tx.objectStore = (storeName) => {
          const store = rec.stores.get(storeName);
          const keyPath = rec.keyPaths.get(storeName);
          function finish(result) {
            const req = { result: result };
            setTimeout(() => { if (tx.oncomplete) tx.oncomplete({}); }, 0);
            return req;
          }
          return {
            put(value) { store.set(value[keyPath], value); return finish(value[keyPath]); },
            delete(key) { store.delete(key); return finish(undefined); },
            getAll() { return finish(Array.from(store.values())); },
          };
        };
        return tx;
      },
    };
  }
  return { open };
}

function createSandbox(knownIds) {
  const elements = new Map();
  (knownIds || []).forEach((id) => elements.set(id, makeElement(id)));
  const listeners = {};

  const document = {
    _elements: elements,
    activeElement: null,
    body: { appendChild() {} },
    querySelector(sel) {
      if (sel[0] === '#') {
        const id = sel.slice(1);
        if (!elements.has(id)) elements.set(id, makeElement(id));
        return elements.get(id);
      }
      return null;
    },
    createElement() { return makeElement('_tmp'); },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
  };

  const sandbox = {
    localStorage: makeLocalStorage(),
    indexedDB: makeFakeIndexedDB(),
    document: document,
    navigator: {
      vibrate() { return true; },
      storage: { persist() { return Promise.resolve(true); } },
      serviceWorker: { register() { return Promise.resolve({}); } },
      standalone: false,
    },
    matchMedia() { return { matches: false }; },
    URL: { createObjectURL() { return 'blob:fake'; }, revokeObjectURL() {} },
    Blob: function Blob() {},
    Image: function Image() { this.onload = null; this.onerror = null; },
    console: console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    Capacitor: undefined,
    __listeners: listeners,
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  return sandbox;
}

module.exports = { createSandbox };
