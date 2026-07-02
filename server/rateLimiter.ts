/**
 * rateLimiter.ts — İki bağımsız limitleyici.
 *  - TokenBucket: metro.istanbul'a giden çıkış trafiğini sınırlar (nazik davranış).
 *  - SlidingWindowLimiter: kendi API'mize gelen IP başına isteği sınırlar.
 */

export class TokenBucket {
  private capacity: number
  private tokens: number
  private refillPerMs: number
  private last: number

  constructor({ ratePerSec, burst }: { ratePerSec: number; burst: number }) {
    // ratePerSec<=0 / NaN yapılandırılırsa refill 0 olur ve acquire() sonsuza dek
    // asılırdı; en az 0.1 req/sn'e sabitliyoruz.
    const rate = Number.isFinite(ratePerSec) && ratePerSec > 0 ? ratePerSec : 0.1
    this.capacity = Math.max(1, Number.isFinite(burst) && burst > 0 ? burst : 1)
    this.tokens = this.capacity
    this.refillPerMs = rate / 1000
    this.last = Date.now()
  }

  private refill(): void {
    const now = Date.now()
    const elapsed = now - this.last
    if (elapsed > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs)
      this.last = now
    }
  }

  /** Bir jeton hazır olana kadar bekler. */
  async acquire(): Promise<void> {
    this.refill()
    while (this.tokens < 1) {
      const deficit = 1 - this.tokens
      const waitMs = Math.ceil(deficit / this.refillPerMs)
      await new Promise((r) => setTimeout(r, Math.min(waitMs, 1000)))
      this.refill()
    }
    this.tokens -= 1
  }
}

export interface RateCheck {
  allowed: boolean
  remaining: number
  retryAfterMs: number
}

export class SlidingWindowLimiter {
  private windowMs: number
  private max: number
  private hits = new Map<string, number[]>()

  constructor({ windowMs, max }: { windowMs: number; max: number }) {
    this.windowMs = windowMs
    this.max = max
  }

  check(key: string): RateCheck {
    const now = Date.now()
    const cutoff = now - this.windowMs
    const arr = (this.hits.get(key) || []).filter((t) => t > cutoff)
    if (arr.length >= this.max) {
      const retryAfterMs = arr[0] + this.windowMs - now
      this.hits.set(key, arr)
      return { allowed: false, remaining: 0, retryAfterMs: Math.max(0, retryAfterMs) }
    }
    arr.push(now)
    this.hits.set(key, arr)
    return { allowed: true, remaining: this.max - arr.length, retryAfterMs: 0 }
  }

  /** Ara sıra çağrılıp eski anahtarları temizler (bellek sızıntısı önleme). */
  sweep(): void {
    const cutoff = Date.now() - this.windowMs
    for (const [key, arr] of this.hits) {
      const filtered = arr.filter((t) => t > cutoff)
      if (filtered.length === 0) this.hits.delete(key)
      else this.hits.set(key, filtered)
    }
  }
}
