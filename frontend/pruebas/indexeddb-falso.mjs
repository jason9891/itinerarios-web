// IndexedDB mínimo en memoria: solo lo que usa cemento-v3/session-store.js (get/put/delete/getAllKeys/clear).
const dbs = new Map(); // nombre → Map(store → Map(key → value))
const clone = (v) => (v === undefined ? undefined : structuredClone(v));

function makeDb(stores) {
  return {
    objectStoreNames: { contains: (s) => stores.has(s) },
    createObjectStore: (s) => { if (!stores.has(s)) stores.set(s, new Map()); },
    close() {},
    transaction(storeName) {
      const st = stores.get(storeName);
      const tx = { oncomplete: null, onerror: null, error: null };
      let pending = 0, scheduled = false;
      const maybeComplete = () => {
        if (pending === 0 && !scheduled) { scheduled = true; setTimeout(() => tx.oncomplete?.({ target: tx }), 0); }
      };
      const op = (fn) => {
        pending++;
        const r = { result: undefined, error: null, onsuccess: null, onerror: null };
        queueMicrotask(() => {
          try { r.result = fn(); r.onsuccess?.({ target: r }); }
          catch (e) { r.error = e; tx.error = e; r.onerror?.({ target: r }); tx.onerror?.({ target: tx }); }
          pending--;
          Promise.resolve().then(maybeComplete);
        });
        return r;
      };
      tx.objectStore = () => ({
        get: (k) => op(() => clone(st.get(k))),
        put: (v, k) => op(() => { st.set(k, clone(v)); return k; }),
        delete: (k) => op(() => { st.delete(k); }),
        clear: () => op(() => { st.clear(); }),
        getAllKeys: () => op(() => [...st.keys()]),
      });
      setTimeout(maybeComplete, 0);
      return tx;
    },
  };
}

globalThis.indexedDB = {
  open(name) {
    const r = { result: null, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
    queueMicrotask(() => {
      const nuevo = !dbs.has(name);
      if (nuevo) dbs.set(name, new Map());
      r.result = makeDb(dbs.get(name));
      if (nuevo) r.onupgradeneeded?.({ target: r });
      r.onsuccess?.({ target: r });
    });
    return r;
  },
  deleteDatabase(name) {
    const r = { onsuccess: null, onerror: null, onblocked: null };
    queueMicrotask(() => { dbs.delete(name); r.onsuccess?.({}); });
    return r;
  },
};
