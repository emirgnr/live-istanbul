/**
 * config.ts — Sunucu ayarları tek yerde, ortam değişkenleriyle override edilebilir.
 * Bağımlılıksız minik .env yükleyici (repo kökündeki .env'i okur, dotenv gerektirmez).
 */

import fs from 'node:fs'
import path from 'node:path'

;(function loadDotEnv() {
  try {
    const envPath = path.join(import.meta.dirname, '..', '.env')
    if (!fs.existsSync(envPath)) return
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
      if (!m) continue
      const key = m[1]
      const val = m[2].replace(/^["']|["']$/g, '')
      if (process.env[key] === undefined) process.env[key] = val
    }
  } catch {
    /* .env yoksa sorun değil */
  }
})()

function int(name: string, def: number): number {
  const v = process.env[name]
  const n = v == null ? NaN : parseInt(v, 10)
  return Number.isFinite(n) ? n : def
}

const metroBase = process.env.METRO_BASE || 'https://www.metro.istanbul'
const seferPagePath = '/SeferDurumlari/SeferDetaylari'
const ajaxPath = '/SeferDurumlari/AJAXSeferGetir'

export const config = {
  // SERVER_PORT (server-özel) — VITE'ın PORT'uyla çakışmasın diye ayrı isim
  port: int('SERVER_PORT', 3001),

  metroBase,
  seferPagePath,
  ajaxPath,
  seferPageUrl: metroBase + seferPagePath,
  ajaxUrl: metroBase + ajaxPath,

  // Taze ASP.NET_SessionId + kod yeniden kullanım süresi (ms)
  sessionTtlMs: int('SESSION_TTL_MS', 20 * 60 * 1000),
  // Hat/durak eşleştirmesinin canlı tazelenme aralığı (ms)
  mappingTtlMs: int('MAPPING_TTL_MS', 6 * 60 * 60 * 1000),
  // Aynı (durak,yön) için yanıt cache süresi (ms) — mimari kararı ~10 sn
  responseCacheTtlMs: int('RESPONSE_CACHE_TTL_MS', 10 * 1000),

  // metro.istanbul'a giden çıkış hızı (token-bucket)
  upstreamRatePerSec: int('UPSTREAM_RATE_PER_SEC', 4),
  upstreamBurst: int('UPSTREAM_BURST', 8),

  // Kendi API'mize IP başına limit
  apiRateWindowMs: int('API_RATE_WINDOW_MS', 60 * 1000),
  apiRateMax: int('API_RATE_MAX', 120),

  requestTimeoutMs: int('REQUEST_TIMEOUT_MS', 15 * 1000),

  timezone: process.env.TZ_NAME || 'Europe/Istanbul',

  // HTTP header değerleri Latin1/ByteString olmalı; ASCII tutulur.
  userAgent:
    process.env.USER_AGENT ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MetroLiveIstanbul/1.0 (+personal transit app)',

  logLevel: process.env.LOG_LEVEL || 'info',

  // CORS: "*" ya da virgülle ayrık origin listesi
  corsOrigin: process.env.CORS_ORIGIN || '*',

  // Express "trust proxy": false (varsayılan) | true | hop sayısı. Yalnızca gerçek bir
  // ters proxy/CDN arkasındaysanız açın; aksi halde X-Forwarded-For taklidiyle rate-limit
  // baypas edilebilir.
  trustProxy: ((): boolean | number => {
    const v = process.env.TRUST_PROXY
    if (v == null || v === '' || v === 'false') return false
    if (v === 'true') return true
    const n = parseInt(v, 10)
    return Number.isFinite(n) ? n : false
  })(),
}

export type Config = typeof config
