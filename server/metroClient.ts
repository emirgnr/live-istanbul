/**
 * metroClient.ts — Tersine mühendislikle çözülmüş metro.istanbul çekirdeği.
 *
 * Akış (canlı doğrulandı):
 *  1) GET /SeferDurumlari/SeferDetaylari -> Set-Cookie ASP.NET_SessionId (anonim) +
 *     HTML'de gömülü statik "kod" (deploy'lar arası döner, her GET'te taze kazınır).
 *  2) POST /SeferDurumlari/AJAXSeferGetir (x-www-form-urlencoded) -> JSON
 *     { durum:"0", sefer:[{istasyon,hat,durak1,durak2,zaman:"HH:MM",gun}] } veya
 *     { durum:"-1", bilgi:"Geçersiz işlem..." } (bayat kod/oturum -> bir kez tazele+dene).
 */

import { config } from './config'
import { log } from './logger'
import { parseKod } from './mappingParser'
import { TokenBucket } from './rateLimiter'

export interface SeferItem {
  istasyon: string
  hat: string
  durak1: string
  durak2: string
  zaman: string
  gun: number
  [k: string]: unknown
}

export interface SeferResponse {
  durum: string
  sefer?: SeferItem[]
  bilgi?: string
}

export interface SeferQuery {
  stationId: string
  routeId: string
  secim?: string
  tarih2?: string
  saat?: string
  dakika?: string
  tarih1?: string
}

interface Context {
  cookie: string
  kod: string
  fetchedAt: number
}

/** Yukarı-akış (gateway) hatası — HTTP status ile etiketli. */
export class UpstreamError extends Error {
  status: number
  constructor(message: string, status = 502) {
    super(message)
    this.name = 'UpstreamError'
    this.status = status
  }
}

const upstreamBucket = new TokenBucket({
  ratePerSec: config.upstreamRatePerSec,
  burst: config.upstreamBurst,
})

let context: Context | null = null
let contextPromise: Promise<Context> | null = null
let pageObserver: ((html: string) => void) | null = null

export function setPageObserver(fn: (html: string) => void): void {
  pageObserver = fn
}

/**
 * Zaman aşımlı fetch. Gövde (res.text()) de timer altında okunur — headers gelip gövde
 * takılırsa da abort tetiklenir.
 */
async function timedFetch(
  url: string,
  options: RequestInit = {},
): Promise<{ res: Response; text: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs)
  try {
    await upstreamBucket.acquire() // nazik davran
    const res = await fetch(url, { ...options, signal: controller.signal })
    const text = await res.text()
    return { res, text }
  } catch (e) {
    const err = e as { name?: string; status?: number }
    if (err && err.name === 'AbortError') {
      throw new UpstreamError(`Zaman aşımı: ${url} ${config.requestTimeoutMs}ms içinde yanıt vermedi.`, 504)
    }
    if (!err.status) err.status = 502
    throw e
  } finally {
    clearTimeout(timer)
  }
}

function extractSessionCookie(res: Response): string | null {
  let cookies: string[] = []
  const anyHeaders = res.headers as Headers & { getSetCookie?: () => string[] }
  if (typeof anyHeaders.getSetCookie === 'function') {
    cookies = anyHeaders.getSetCookie()
  } else {
    const raw = res.headers.get('set-cookie')
    if (raw) cookies = [raw]
  }
  for (const c of cookies) {
    const m = c.match(/ASP\.NET_SessionId=([^;]+)/i)
    if (m) return `ASP.NET_SessionId=${m[1]}`
  }
  return null
}

/** SeferDetaylari sayfasını GET'ler; taze cookie + kod döndürür, HTML'i observer'a iletir. */
export async function fetchSeferPage(): Promise<{ cookie: string; kod: string; html: string }> {
  const { res, text: html } = await timedFetch(config.seferPageUrl, {
    method: 'GET',
    headers: {
      'User-Agent': config.userAgent,
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'tr-TR,tr;q=0.9',
    },
  })
  if (!res.ok) throw new UpstreamError(`SeferDetaylari GET başarısız: HTTP ${res.status}`, 502)

  const cookie = extractSessionCookie(res)
  const kod = parseKod(html)
  if (!cookie) throw new UpstreamError('ASP.NET_SessionId cookie alınamadı.', 502)
  if (!kod) throw new UpstreamError('Sayfadan "kod" çıkarılamadı — yapı değişmiş olabilir.', 502)

  if (pageObserver) {
    try {
      pageObserver(html)
    } catch (e) {
      log.warn('pageObserver hata verdi:', (e as Error).message)
    }
  }

  log.info(`Taze bağlam alındı (kod=${kod.slice(0, 8)}…, cookie ok).`)
  return { cookie, kod, html }
}

/** Geçerli (cookie + kod) bağlamını döndürür; TTL dolduysa tazeler. */
export async function getContext(forceRefresh = false): Promise<Context> {
  const fresh = !forceRefresh && context && Date.now() - context.fetchedAt < config.sessionTtlMs
  if (fresh) return context!

  if (contextPromise) return contextPromise

  contextPromise = (async () => {
    const { cookie, kod } = await fetchSeferPage()
    context = { cookie, kod, fetchedAt: Date.now() }
    return context
  })()

  try {
    return await contextPromise
  } finally {
    contextPromise = null
  }
}

/** AJAXSeferGetir'e sorgu atar. Bayat kod/oturumda bir kez tazeleyip yeniden dener. */
export async function querySefer(q: SeferQuery, _retried = false): Promise<SeferResponse> {
  const ctx = await getContext()

  const body = new URLSearchParams({
    secim: q.secim || '1',
    saat: q.saat || '',
    dakika: q.dakika || '',
    tarih1: q.tarih1 || '',
    tarih2: q.tarih2 || '',
    station: String(q.stationId),
    route: String(q.routeId),
    kod: ctx.kod,
  })

  const { res, text } = await timedFetch(config.ajaxUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: config.seferPageUrl,
      Origin: config.metroBase,
      'User-Agent': config.userAgent,
      Accept: 'application/json, text/javascript, */*; q=0.01',
      Cookie: ctx.cookie,
    },
    body: body.toString(),
    redirect: 'manual', // secim=2/3 eksik alanla 302 -> otomatik takip etme
  })

  let data: SeferResponse
  try {
    data = JSON.parse(text)
  } catch {
    if (!_retried) {
      log.warn('Beklenmeyen (JSON olmayan) yanıt; bağlam tazelenip yeniden denenecek.')
      await getContext(true)
      return querySefer(q, true)
    }
    throw new UpstreamError(`AJAXSeferGetir JSON olmayan yanıt döndürdü (HTTP ${res.status}).`, 502)
  }

  if (data && data.durum === '-1' && !_retried && /geçersiz işlem/i.test(data.bilgi || '')) {
    log.warn('durum=-1 "Geçersiz işlem" — bağlam tazelenip yeniden denenecek.')
    await getContext(true)
    return querySefer(q, true)
  }

  return data
}

export const _upstreamBucket = upstreamBucket
