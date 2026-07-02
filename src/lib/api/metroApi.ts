/**
 * metroApi.ts — Entegre canlı sefer backend'i (server/) için tipli istemci.
 *
 * Taban URL:
 *  - Dev'de VITE_API_BASE_URL boş -> "/api/..." aynı origin'e gider, Vite proxy backend'e iletir.
 *  - Prod'da (GitHub Pages) VITE_API_BASE_URL = ayrı barındırılan backend'in tam URL'i.
 */

export interface ApiSefer {
  /** "22:47" — kalkış saati */
  varis_saati: string
  /** İstanbul saatine göre kalan dakika (>= 0) */
  kalan_dakika: number
  /** Yön / son durak adı */
  hedef: string | null
}

export interface ApiDirectionBoard {
  routeId: string
  /** "Bakırköy Sahil-->>Kayaşehir Merkez" */
  yon: string
  hedef: string | null
  seferler: ApiSefer[]
  sonraki: ApiSefer | null
}

export interface ApiStationBoard {
  istasyon: string
  stationId: string
  hat: string
  hatKodu: string
  renk: string | null
  yonler: ApiDirectionBoard[]
  guncelleme: string
  kaynak: string
}

export interface ApiLineStation {
  stationId: string
  ad: string
}
export interface ApiLineDirection {
  routeId: string
  etiket: string
  hedef: string | null
}
export interface ApiLine {
  index: number
  kod: string
  ad: string
  renk: string | null
  yonler: ApiLineDirection[]
  duraklar: ApiLineStation[]
}
export interface ApiLinesResponse {
  meta: { lineCount: number; updatedAt: string; source: string }
  hatlar: ApiLine[]
}

const BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')
const DEFAULT_TIMEOUT_MS = 8000

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)
  // Dışarıdan gelen iptal (bileşen unmount) de fetch'i iptal etsin. Listener normal
  // tamamlanmada finally'de kaldırılır (uzun ömürlü sinyallerde birikmesin).
  const onAbort = () => controller.abort()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
    const text = await res.text()
    let body: unknown
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = null
    }
    if (!res.ok) {
      const msg = (body as { hata?: string })?.hata || `İstek başarısız (HTTP ${res.status})`
      throw new ApiError(msg, res.status)
    }
    return body as T
  } finally {
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', onAbort)
  }
}

/** Tüm hatlar (kod, ad, renk, yönler, duraklar). UI dropdown'ları ve isim köprüsü için. */
export function getLines(signal?: AbortSignal): Promise<ApiLinesResponse> {
  return getJson<ApiLinesResponse>('/api/lines', signal)
}

/** Bir durağın TÜM yönleri için sonraki canlı seferler (Yaklaşan Seferler ekranı). */
export function getStationBoard(
  lineCode: string,
  station: string,
  opts: { limit?: number; signal?: AbortSignal } = {},
): Promise<ApiStationBoard> {
  const qs = new URLSearchParams({ line: lineCode, station })
  if (opts.limit) qs.set('limit', String(opts.limit))
  return getJson<ApiStationBoard>(`/api/stations/board?${qs.toString()}`, opts.signal)
}
