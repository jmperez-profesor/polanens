const DB_NAME = "carpool-volley-spa";
const DB_VERSION = 1;
const FALLBACK_KEY = "carpool-volley-fallback";

const STORES = ["drivers", "kids", "sessions", "trips", "settings"];

const defaultSettings = {
  id: "main",
  activeSeason: "2026-2027",
  activeMonth: "2026-08",
  vacations: [],
  holidays: [],
  darkMode: false,
  seeded: false,
};

const supportsIndexedDB = typeof indexedDB !== "undefined";

function uid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function requestToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

class FallbackDB {
  constructor() {
    this.data = this.load();
  }

  load() {
    const raw = localStorage.getItem(FALLBACK_KEY);
    if (!raw) {
      return {
        drivers: [],
        kids: [],
        sessions: [],
        trips: [],
        settings: [{ ...defaultSettings }],
      };
    }
    return JSON.parse(raw);
  }

  save() {
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(this.data));
  }

  async getAll(store) {
    return [...this.data[store]];
  }

  async get(store, id) {
    return this.data[store].find((item) => item.id === id) ?? null;
  }

  async put(store, value) {
    const id = value.id || uid();
    const next = { ...value, id };
    const idx = this.data[store].findIndex((item) => item.id === id);
    if (idx >= 0) this.data[store][idx] = next;
    else this.data[store].push(next);
    this.save();
    return next;
  }

  async bulkPut(store, values) {
    for (const value of values) await this.put(store, value);
  }

  async delete(store, id) {
    this.data[store] = this.data[store].filter((item) => item.id !== id);
    this.save();
  }

  async clear(store) {
    this.data[store] = [];
    this.save();
  }
}

class IndexedDBWrapper {
  constructor() {
    this.db = null;
  }

  async init() {
    const openReq = indexedDB.open(DB_NAME, DB_VERSION);
    openReq.onupgradeneeded = () => {
      const db = openReq.result;
      if (!db.objectStoreNames.contains("drivers")) db.createObjectStore("drivers", { keyPath: "id" });
      if (!db.objectStoreNames.contains("kids")) db.createObjectStore("kids", { keyPath: "id" });
      if (!db.objectStoreNames.contains("sessions")) {
        const store = db.createObjectStore("sessions", { keyPath: "id" });
        store.createIndex("byDate", "date", { unique: false });
      }
      if (!db.objectStoreNames.contains("trips")) {
        const store = db.createObjectStore("trips", { keyPath: "id" });
        store.createIndex("bySessionId", "sessionId", { unique: false });
        store.createIndex("byDriverId", "driverId", { unique: false });
      }
      if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings", { keyPath: "id" });
    };
    this.db = await requestToPromise(openReq);
  }

  async tx(store, mode, fn) {
    const transaction = this.db.transaction(store, mode);
    const objectStore = transaction.objectStore(store);
    const result = await fn(objectStore);
    await new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    return result;
  }

  async getAll(store) {
    return this.tx(store, "readonly", (s) => requestToPromise(s.getAll()));
  }

  async get(store, id) {
    return this.tx(store, "readonly", (s) => requestToPromise(s.get(id)));
  }

  async put(store, value) {
    const next = value.id ? value : { ...value, id: uid() };
    await this.tx(store, "readwrite", (s) => requestToPromise(s.put(next)));
    return next;
  }

  async bulkPut(store, values) {
    await this.tx(store, "readwrite", async (s) => {
      for (const value of values) {
        const next = value.id ? value : { ...value, id: uid() };
        await requestToPromise(s.put(next));
      }
    });
  }

  async delete(store, id) {
    await this.tx(store, "readwrite", (s) => requestToPromise(s.delete(id)));
  }

  async clear(store) {
    await this.tx(store, "readwrite", (s) => requestToPromise(s.clear()));
  }
}

const impl = supportsIndexedDB ? new IndexedDBWrapper() : new FallbackDB();

export const db = {
  async init() {
    if (impl.init) await impl.init();
    const settings = await this.getSettings();
    if (!settings) await impl.put("settings", defaultSettings);
  },

  uid,

  async getSettings() {
    return impl.get("settings", "main");
  },

  async saveSettings(patch) {
    const current = (await this.getSettings()) ?? defaultSettings;
    return impl.put("settings", { ...current, ...patch, id: "main" });
  },

  async getAll(store) {
    return impl.getAll(store);
  },

  async put(store, value) {
    return impl.put(store, value);
  },

  async bulkPut(store, values) {
    return impl.bulkPut(store, values);
  },

  async delete(store, id) {
    return impl.delete(store, id);
  },

  async clear(store) {
    return impl.clear(store);
  },

  async exportAll() {
    const payload = {};
    for (const store of STORES) payload[store] = await impl.getAll(store);
    return payload;
  },

  async importAll(payload) {
    for (const store of STORES) {
      if (!Array.isArray(payload[store])) continue;
      await impl.clear(store);
      await impl.bulkPut(store, payload[store]);
    }
    const settings = await this.getSettings();
    if (!settings) await impl.put("settings", defaultSettings);
  },
};
