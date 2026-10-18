// The sandbox has no storage (opaque origin), and reading localStorage there throws. Libraries that only use it
// for settings get a throwaway in-memory one instead. Imported before anything else.
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

for (const name of ["localStorage", "sessionStorage"] as const) {
  try {
    void window[name];
  } catch {
    Object.defineProperty(window, name, { value: memoryStorage(), configurable: true });
  }
}
