// Tiny LRU + TTL cache.
// A Map remembers insertion order, so the first key is always the least recently used.
export class Cache {
  constructor(max = 500, ttlMs = 60_000) {
    this.max = max; this.ttl = ttlMs; this.m = new Map(); this.hits = 0; this.misses = 0;
  }
  get(key) {
    const e = this.m.get(key);
    if (!e || e.exp < Date.now()) {          // missing or expired
      if (e) this.m.delete(key);
      this.misses++; return undefined;
    }
    this.m.delete(key); this.m.set(key, e);  // move to the "most recent" end
    this.hits++; return e.value;
  }
  set(key, value) {
    this.m.delete(key);
    this.m.set(key, { value, exp: Date.now() + this.ttl });
    if (this.m.size > this.max) this.m.delete(this.m.keys().next().value); // evict oldest
  }
  stats() { return { size: this.m.size, hits: this.hits, misses: this.misses }; }
}

// Embeddings never change for the same text, so cache them for a long time.
export const embedCache = new Cache(2000, 24 * 60 * 60 * 1000);
// Search results are cached briefly.
export const searchCache = new Cache(300, 60_000);
// Cache invalidation trick: the version is part of every search cache key.
// Adding a document bumps it, so old cached results are never served again.
export const corpus = { version: 1 };
