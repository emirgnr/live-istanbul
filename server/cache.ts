/**
 * cache.ts — In-memory TTL cache + single-flight (dedupe).
 *  1) TTL cache: aynı (durak,yön) için ~10 sn içinde gelen istekleri upstream'e iletmeden yanıtlar.
 *  2) Single-flight: aynı anahtar için eşzamanlı istekler tek upstream çağrısı paylaşır.
 * Not: producer HATA fırlatırsa değer cache'lenmez (başarısız yanıt asla saklanmaz).
 */

interface Entry<V> {
  value: V
  expiresAt: number
}

export class TtlCache<V = unknown> {
  private store = new Map<string, Entry<V>>()
  private inflight = new Map<string, Promise<V>>()

  get(key: string): V | undefined {
    const hit = this.store.get(key)
    if (!hit) return undefined
    if (hit.expiresAt <= Date.now()) {
      this.store.delete(key)
      return undefined
    }
    return hit.value
  }

  set(key: string, value: V, ttlMs: number): V {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs })
    return value
  }

  /**
   * Cache'de tazeyse onu döndürür; değilse producer()'ı çalıştırıp sonucu cache'ler.
   * Eşzamanlı çağrılar tek producer çalışmasını paylaşır. Producer reddederse cache'lenmez.
   */
  async fetch(
    key: string,
    ttlMs: number,
    producer: () => Promise<V>,
  ): Promise<{ value: V; fromCache: boolean }> {
    const cached = this.get(key)
    if (cached !== undefined) return { value: cached, fromCache: true }

    const existing = this.inflight.get(key)
    if (existing) return { value: await existing, fromCache: true }

    const promise = (async () => producer())()
    this.inflight.set(key, promise)
    try {
      const value = await promise
      this.set(key, value, ttlMs)
      return { value, fromCache: false }
    } finally {
      this.inflight.delete(key)
    }
  }

  clear(): void {
    this.store.clear()
    this.inflight.clear()
  }
}
