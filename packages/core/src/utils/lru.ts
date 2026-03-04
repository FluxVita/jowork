// @jowork/core/utils/lru — simple LRU cache (no external deps)
// Used for in-memory session caching to reduce DB reads.

interface Entry<V> {
  value: V;
  expiresAt: number; // 0 = no expiry
}

export class LRUCache<K, V> {
  private readonly _max: number;
  private readonly _ttlMs: number;
  private readonly _map: Map<K, Entry<V>>;

  /**
   * @param max     Maximum number of entries before evicting the LRU item
   * @param ttlMs   TTL in milliseconds (0 = no expiry)
   */
  constructor(max: number, ttlMs = 0) {
    if (max < 1) throw new Error('LRUCache max must be >= 1');
    this._max = max;
    this._ttlMs = ttlMs;
    this._map = new Map();
  }

  get(key: K): V | undefined {
    const entry = this._map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt > 0 && Date.now() > entry.expiresAt) {
      this._map.delete(key);
      return undefined;
    }
    // Move to end (most recently used)
    this._map.delete(key);
    this._map.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    if (this._map.has(key)) {
      this._map.delete(key);
    } else if (this._map.size >= this._max) {
      // Evict least recently used (first entry in Map)
      const lruKey = this._map.keys().next().value;
      if (lruKey !== undefined) this._map.delete(lruKey);
    }
    this._map.set(key, {
      value,
      expiresAt: this._ttlMs > 0 ? Date.now() + this._ttlMs : 0,
    });
  }

  delete(key: K): void {
    this._map.delete(key);
  }

  clear(): void {
    this._map.clear();
  }

  get size(): number {
    return this._map.size;
  }
}
