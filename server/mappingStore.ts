/**
 * mappingStore.ts — Hat/durak/yön eşleştirme tablosunu tutar.
 *  - Açılışta data/stations.seed.json'dan yükler (canlı veri gelmeden de çalışır).
 *  - metroClient her sayfa GET'inde HTML'i buraya iletir (pageObserver) -> canlı tazelenir.
 *  - Durak/yön ID'leri sistem genelinde benzersiz; global indeksler kurulur.
 *  - Çözümleme hem numerik ID hem isimle yapılabilir (frontend isim köprüsü için).
 */

import fs from 'node:fs'
import path from 'node:path'
import { log } from './logger'
import { config } from './config'
import * as metroClient from './metroClient'
import { parseMapping } from './mappingParser'
import type { MetroLine, MetroMapping, MetroStation, MetroRoute } from './mappingParser'

const SEED_PATH = path.join(import.meta.dirname, 'data', 'stations.seed.json')

let mapping: MetroMapping = { lineCount: 0, lines: [] }
let updatedAt = 0
let source: 'none' | 'seed' | 'live' = 'none'

let byStationId = new Map<string, { line: MetroLine; station: MetroStation }>()
let byRouteId = new Map<string, { line: MetroLine; route: MetroRoute }>()

export class HttpError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}
const badRequest = (m: string) => new HttpError(m, 400)
const notFound = (m: string) => new HttpError(m, 404)

function norm(s: string): string {
  return String(s || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/i̇/g, 'i')
    .trim()
}

function rebuildIndexes(): void {
  byStationId = new Map()
  byRouteId = new Map()
  for (const line of mapping.lines) {
    for (const st of line.stations) byStationId.set(String(st.stationId), { line, station: st })
    for (const rt of line.routes) byRouteId.set(String(rt.routeId), { line, route: rt })
  }
}

/** Canlı HTML'den mapping'i günceller (pageObserver). */
export function updateFromHtml(html: string): void {
  try {
    const parsed = parseMapping(html)
    mapping = parsed
    updatedAt = Date.now()
    source = 'live'
    rebuildIndexes()
    log.info(`Mapping canlı güncellendi: ${parsed.lineCount} hat, ${byStationId.size} durak.`)
  } catch (e) {
    log.warn('Canlı mapping ayrıştırılamadı, mevcut korunuyor:', (e as Error).message)
  }
}

export function loadSeed(): boolean {
  try {
    const raw = fs.readFileSync(SEED_PATH, 'utf8')
    const parsed = JSON.parse(raw) as { lines?: MetroLine[]; generatedAt?: string }
    if (parsed && Array.isArray(parsed.lines) && parsed.lines.length) {
      mapping = { lineCount: parsed.lines.length, lines: parsed.lines }
      updatedAt = parsed.generatedAt ? Date.parse(parsed.generatedAt) || Date.now() : Date.now()
      source = 'seed'
      rebuildIndexes()
      log.info(`Mapping seed'den yüklendi: ${mapping.lineCount} hat, ${byStationId.size} durak.`)
      return true
    }
  } catch (e) {
    log.warn('Seed yüklenemedi:', (e as Error).message)
  }
  return false
}

export function init(): void {
  metroClient.setPageObserver(updateFromHtml)
  loadSeed()
}

export function isStale(): boolean {
  return mapping.lines.length === 0 || Date.now() - updatedAt > config.mappingTtlMs
}

export function getLines(): MetroLine[] {
  return mapping.lines
}

export function getMeta() {
  return {
    lineCount: mapping.lineCount,
    updatedAt: new Date(updatedAt).toISOString(),
    source,
  }
}

export function findLine(line: string | number | null | undefined): MetroLine | null {
  if (line == null || line === '') return null
  const key = String(line)
  return (
    mapping.lines.find((l) => String(l.index) === key) ||
    mapping.lines.find((l) => norm(l.code) === norm(key)) ||
    null
  )
}

/** Durağı (numerik id veya isim) çözer; opsiyonel line ipucuyla isim belirsizliğini giderir. */
export function resolveStation(params: {
  line?: string | number | null
  station: string | number
}): { line: MetroLine; station: MetroStation } {
  const { line, station } = params
  if (station == null || station === '') throw badRequest('station parametresi zorunlu.')
  const lineHint = findLine(line)

  if (/^\d+$/.test(String(station))) {
    const rec = byStationId.get(String(station))
    if (!rec) throw notFound(`station id bulunamadı: ${station}`)
    return rec
  }

  const target = norm(String(station))
  const candidates: { line: MetroLine; station: MetroStation }[] = []
  for (const l of mapping.lines) {
    if (lineHint && l.index !== lineHint.index) continue
    for (const st of l.stations) if (norm(st.name) === target) candidates.push({ line: l, station: st })
  }
  if (candidates.length === 0) throw notFound(`durak bulunamadı: "${station}"`)
  if (candidates.length > 1) {
    throw badRequest(
      `"${station}" birden çok hatta var; line parametresiyle belirtin: ` +
        candidates.map((c) => c.line.code).join(', '),
    )
  }
  return candidates[0]
}

/** station + route (+opsiyonel line) çözer ve tutarlılığı doğrular. */
export function resolve(params: {
  line?: string | number | null
  station: string | number
  route: string | number
}): { line: MetroLine; station: MetroStation; route: MetroRoute } {
  const { route } = params
  if (route == null || route === '') throw badRequest('route parametresi zorunlu.')

  const stationRec = resolveStation(params)
  const line_ = stationRec.line

  let routeRec: { line: MetroLine; route: MetroRoute }
  if (/^\d+$/.test(String(route))) {
    const global = byRouteId.get(String(route))
    if (!global) throw notFound(`route id bulunamadı: ${route}`)
    routeRec = global
  } else {
    const target = norm(String(route))
    const match = line_.routes.find(
      (r) => norm(r.label) === target || norm(r.to || '') === target || norm(r.from || '') === target,
    )
    if (!match) {
      throw notFound(
        `"${route}" yönü ${line_.code} hattında bulunamadı. Geçerli yönler: ` +
          line_.routes.map((r) => r.label).join(' | '),
      )
    }
    routeRec = { line: line_, route: match }
  }

  if (routeRec.line.index !== line_.index) {
    throw badRequest(`Uyumsuz: durak ${line_.code} hattında ama route ${routeRec.line.code} hattına ait.`)
  }

  const routeServesStation =
    !stationRec.station.routeIds ||
    stationRec.station.routeIds.length === 0 ||
    stationRec.station.routeIds.map(String).includes(String(routeRec.route.routeId))
  if (!routeServesStation) {
    const valid = line_.routes
      .filter((r) => stationRec.station.routeIds.map(String).includes(String(r.routeId)))
      .map((r) => `${r.routeId}=${r.label}`)
      .join(' | ')
    throw badRequest(
      `route ${routeRec.route.routeId} bu duraktan (${stationRec.station.name}) geçmiyor. ` +
        `Bu durak için geçerli yönler: ${valid || '(yok)'}`,
    )
  }

  return { line: line_, station: stationRec.station, route: routeRec.route }
}

export { SEED_PATH }
export type { MetroLine, MetroStation, MetroRoute }
