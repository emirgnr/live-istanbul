/**
 * seferService.ts — İş mantığı: çöz -> cache -> upstream sorgu -> kalan dakika zenginleştir.
 * İki üst seviye çıktı:
 *   getDepartures  — tek yön (station+route) için sonraki seferler.
 *   getStationBoard — bir durağın TÜM yönleri için sonraki seferler (durak panosu).
 */

import { config } from './config'
import { log } from './logger'
import * as metroClient from './metroClient'
import * as mappingStore from './mappingStore'
import { TtlCache } from './cache'
import { istanbulParts, istanbulDateStr, minutesUntil } from './timeUtils'
import type { SeferResponse } from './metroClient'

const cache = new TtlCache<SeferResponse>()

export interface Sefer {
  varis_saati: string
  kalan_dakika: number
  hedef: string | null
}

export interface Departures {
  istasyon: string
  hat: string
  hatKodu: string
  renk: string | null
  yon: string
  hedef: string | null
  routeId: string
  stationId: string
  sonraki: Sefer | null
  seferler: Sefer[]
  guncelleme: string
  kaynak: string
  cache: boolean
}

export interface DirectionBoard {
  routeId: string
  yon: string
  hedef: string | null
  seferler: Sefer[]
  sonraki: Sefer | null
}

export interface StationBoard {
  istasyon: string
  stationId: string
  hat: string
  hatKodu: string
  renk: string | null
  yonler: DirectionBoard[]
  guncelleme: string
  kaynak: string
}

class UpstreamError extends Error {
  status: number
  constructor(message: string, status = 502) {
    super(message)
    this.status = status
  }
}

interface DeparturesParams {
  line?: string | number | null
  station: string | number
  route: string | number
  secim?: string
  limit?: number
}

export async function getDepartures(params: DeparturesParams): Promise<Departures> {
  const secim = params.secim ? String(params.secim) : '1'
  const limit = Number.isFinite(Number(params.limit)) && Number(params.limit) > 0 ? Number(params.limit) : 20

  const resolved = mappingStore.resolve(params) // hata fırlatabilir (400/404)
  const tarih2 = istanbulDateStr()
  const cacheKey = `dep:${resolved.station.stationId}:${resolved.route.routeId}:${secim}:${tarih2}`

  // Doğrulama producer'ın İÇİNDE: hata (durum:-1/boş) fırlatılırsa cache'lenmez, böylece
  // bağlam kendini iyileştirince bir sonraki istek hemen tazeyi dener.
  const { value: raw, fromCache } = await cache.fetch(cacheKey, config.responseCacheTtlMs, async () => {
    const r = await metroClient.querySefer({
      stationId: resolved.station.stationId,
      routeId: resolved.route.routeId,
      secim,
      tarih2,
    })
    if (!r || typeof r !== 'object') throw new UpstreamError('metro.istanbul boş/geçersiz yanıt döndürdü.')
    if (r.durum === '-1') throw new UpstreamError(r.bilgi || 'metro.istanbul isteği reddetti.')
    return r
  })

  const now = istanbulParts()
  const list = Array.isArray(raw.sefer) ? raw.sefer : []
  const seferler: Sefer[] = list
    .map((s) => ({
      varis_saati: s.zaman,
      kalan_dakika: minutesUntil(s.zaman, now, s.gun) as number,
      hedef: s.durak2 || resolved.route.to || null,
    }))
    .filter((s) => s.kalan_dakika != null)
    .sort((a, b) => a.kalan_dakika - b.kalan_dakika)
    .slice(0, limit)

  return {
    istasyon: resolved.station.name,
    hat: resolved.line.name,
    hatKodu: resolved.line.code,
    renk: resolved.line.color,
    yon: resolved.route.label,
    hedef: resolved.route.to,
    routeId: resolved.route.routeId,
    stationId: resolved.station.stationId,
    sonraki: seferler[0] || null,
    seferler,
    guncelleme: new Date().toISOString(),
    kaynak: 'metro.istanbul/SeferDurumlari',
    cache: fromCache,
  }
}

/**
 * Bir durağın TÜM yönleri için sonraki seferler. Frontend "Yaklaşan Seferler" ekranı bunu
 * kullanır: durak + hat verilir, her yön için en yakın seferler döner.
 */
export async function getStationBoard(params: {
  line?: string | number | null
  station: string | number
  limit?: number
}): Promise<StationBoard> {
  const limit = Number.isFinite(Number(params.limit)) && Number(params.limit) > 0 ? Number(params.limit) : 6
  const { line, station } = mappingStore.resolveStation(params)

  // Bu duraktan geçen geçerli yönler; yoksa hattın tüm yönleri.
  const routeIds =
    station.routeIds && station.routeIds.length
      ? station.routeIds
      : line.routes.map((r) => r.routeId)

  const results = await Promise.allSettled(
    routeIds.map((routeId) =>
      getDepartures({ line: line.code, station: station.stationId, route: routeId, limit }),
    ),
  )

  const yonler: DirectionBoard[] = []
  for (const r of results) {
    if (r.status === 'fulfilled') {
      yonler.push({
        routeId: r.value.routeId,
        yon: r.value.yon,
        hedef: r.value.hedef,
        seferler: r.value.seferler,
        sonraki: r.value.sonraki,
      })
    } else {
      log.debug('Board yön sorgusu başarısız:', (r.reason as Error)?.message)
    }
  }

  if (yonler.length === 0) {
    throw new UpstreamError('Bu durak için hiçbir yönden canlı sefer alınamadı.')
  }

  return {
    istasyon: station.name,
    stationId: station.stationId,
    hat: line.name,
    hatKodu: line.code,
    renk: line.color,
    yonler,
    guncelleme: new Date().toISOString(),
    kaynak: 'metro.istanbul/SeferDurumlari',
  }
}

/** Açılışta bağlamı ve mapping'i ısıt. */
export async function warmup(): Promise<void> {
  try {
    await metroClient.getContext()
    log.info('Warmup tamam: taze bağlam + canlı mapping hazır.')
  } catch (e) {
    log.warn('Warmup başarısız (seed ile devam):', (e as Error).message)
  }
}

export const _cache = cache
