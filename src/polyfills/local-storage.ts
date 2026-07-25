/**
 * Minimal `localStorage` Polyfill (Node.js)
 *
 * `komodo_client`'s transitive dependency `mogh_auth_client` unconditionally
 * calls `localStorage.getItem(...)` in a top-level IIFE (see its
 * dist/tokens.js) — a browser-only global, with no guard and no Node
 * fallback. Any Node.js process importing `komodo_client` throws
 * `ReferenceError: localStorage is not defined` at module-load time unless
 * something defines it first.
 *
 * Confirmed against both packages' latest published versions (komodo_client
 * 2.1.1, mogh_auth_client 1.7.0) — this is an upstream bug in a dependency
 * we don't control, not something a version bump fixes.
 *
 * This is a minimal in-memory Web-Storage-shaped shim, installed as a
 * global only if `localStorage` isn't already defined (defensive — never
 * clobbers a real implementation, e.g. under jsdom). Import this module
 * for its side effect *before* anything that transitively imports
 * `komodo_client` — see client.ts's first import.
 *
 * @module polyfills/local-storage
 */

interface MinimalStorage {
  readonly length: number;
  clear(): void;
  getItem(key: string): string | null;
  key(index: number): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

class InMemoryStorage implements MinimalStorage {
  private readonly store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

declare global {
  // `var` is required syntax for global augmentation (not a real runtime declaration)
  var localStorage: MinimalStorage | undefined;
}

if (typeof globalThis.localStorage === "undefined") {
  globalThis.localStorage = new InMemoryStorage();
}
