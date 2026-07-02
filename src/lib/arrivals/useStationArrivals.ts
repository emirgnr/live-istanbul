/**
 * useStationArrivals — "Yaklaşan Seferler" için CANLI veri kaynağı.
 *
 * Yalnızca metro.istanbul canlı verisi gösterilir (simülasyon fallback'i YOKTUR —
 * simüle dakika tamamen kaldırıldı, çünkü gerçek sefer saatiyle uyuşmuyordu).
 *  - Kapsanan hatlar (M/T/F/TF) için canlı kalan-dakika.
 *  - Kapsanmayan hatlar (Marmaray, Metrobüs, M11) → canlı kaynak yok → hiç dakika gösterilmez.
 *  - Frontend istasyon/hat kimlikleri ile metro.istanbul kimlikleri İSİMLE köprülenir.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { getLine, getStation, familyLineIds } from '@/data'
import { getLines, getStationBoard, type ApiStationBoard } from '@/lib/api/metroApi'
import type { Line, LineId, StationId } from '@/lib/network/types'

const LIVE_REFRESH_MS = 20_000

export interface ArrivalRow {
  key: string
  lineId: LineId
  towardId: StationId | null
  towardName: string
  /** Saniye cinsinden varışa kalan (kalan_dakika*60). */
  etaSec: number
  /** Her zaman true — kaynak metro.istanbul canlı verisidir. */
  live: true
}

const norm = (s: string | undefined | null): string =>
  String(s || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/i̇/g, 'i')
    .trim()

const nameMatches = (a: string, b: string): boolean =>
  !!a && !!b && (a === b || a.startsWith(b) || b.startsWith(a))

// ── Kapsanan hat kodları (backend /api/lines'tan bir kez, modül düzeyinde cache) ──
// Paylaşılan singleton fetch'e bileşene özel AbortSignal BAĞLANMAZ; aksi halde bir
// bileşenin unmount'ı paylaşılan isteği iptal edip diğer tüketicileri bozar.
let coveredPromise: Promise<Set<string>> | null = null
function coveredCodes(): Promise<Set<string>> {
  if (!coveredPromise) {
    coveredPromise = getLines()
      .then((r) => new Set(r.hatlar.map((h) => norm(h.kod))))
      .catch((e) => {
        coveredPromise = null // hata: sonraki denemede tekrar dene
        throw e
      })
  }
  return coveredPromise
}

/** Yönün hedef durağını frontend hattında bulur (kısa-tur ara-istasyon hedefleri dahil). */
function resolveTowardId(line: Line, hedef: string): StationId | null {
  const nh = norm(hedef)
  if (!nh) return null
  let hi = line.stations.findIndex((sid) => norm(getStation(sid)?.name.tr) === nh)
  if (hi < 0) hi = line.stations.findIndex((sid) => nameMatches(norm(getStation(sid)?.name.tr), nh))
  return hi >= 0 ? line.stations[hi] : null
}

/** Backend station board'unu bir frontend hattı için canlı satırlara çevirir. */
function boardToRows(line: Line, board: ApiStationBoard): ArrivalRow[] {
  const rows: ArrivalRow[] = []
  for (const y of board.yonler) {
    if (!y.sonraki) continue // bu yönde yaklaşan sefer yok
    const hedef = y.hedef ?? y.sonraki.hedef ?? ''
    const towardId = resolveTowardId(line, hedef)
    rows.push({
      key: `live|${line.id}|${y.routeId}`,
      lineId: line.id,
      towardId,
      towardName: hedef || (towardId ? getStation(towardId)?.name.tr ?? '' : ''),
      etaSec: Math.max(0, Math.round(y.sonraki.kalan_dakika * 60)),
      live: true,
    })
  }
  return rows
}

export interface StationArrivals {
  /** Sadece canlı yaklaşan seferler (kalan-dakikaya göre sıralı). */
  approaching: ArrivalRow[]
  /** Kapsama/veri belirlenene kadar true — UI "yükleniyor" gösterir (yanlış sayı yerine). */
  loading: boolean
  /** Bu durağın hatlarından en az biri metro.istanbul tarafından kapsanıyor mu. */
  hasLiveSource: boolean
}

/**
 * Bir istasyon için canlı yaklaşan seferler.
 * @param stationId frontend istasyon id'si
 * @param allowedLineIds şema görünümü hatları belirli hatlara daralttıysa (opsiyonel)
 */
export function useStationArrivals(
  stationId: StationId | null,
  allowedLineIds?: LineId[] | null,
): StationArrivals {
  // Yüklenen satırlar, ait oldukları (durak|hatlar) anahtarıyla birlikte tutulur; böylece
  // başka durağın verisi asla gösterilmez ve "yükleniyor" durumu doğru hesaplanır.
  const [live, setLive] = useState<{ key: string; rows: ArrivalRow[] }>({ key: '', rows: [] })
  const [covered, setCovered] = useState<Set<string> | null>(null)
  const liveReqId = useRef(0)

  const st = stationId ? getStation(stationId) : null

  const allowed = useMemo(
    () =>
      allowedLineIds && allowedLineIds.length
        ? new Set(allowedLineIds.flatMap((id) => familyLineIds(id)))
        : null,
    [allowedLineIds],
  )

  const servingLines = useMemo<Line[]>(() => {
    if (!st) return []
    return st.lines
      .filter((id) => !allowed || allowed.has(id))
      .map((id) => getLine(id))
      .filter((l): l is Line => !!l && !l.shell)
  }, [st, allowed])

  const liveLines = useMemo(
    () => (covered ? servingLines.filter((l) => covered.has(norm(l.code))) : []),
    [servingLines, covered],
  )
  const liveLinesKey = liveLines.map((l) => l.id).join(',')

  // Kapsanan hat kümesini bir kez getir (paylaşılan singleton; mount sinyaline bağlı değil).
  useEffect(() => {
    let alive = true
    coveredCodes()
      .then((s) => alive && setCovered(s))
      .catch(() => alive && setCovered(new Set())) // backend yok -> canlı kaynak yok
    return () => {
      alive = false
    }
  }, [])

  const currentKey = st ? `${st.id}|${liveLinesKey}` : ''

  // Canlı veriyi periyodik getir (durak/kapsanan-hat değişiminde + her 20 sn).
  useEffect(() => {
    if (!st || liveLines.length === 0) return
    const reqId = ++liveReqId.current
    let stopped = false
    const ac = new AbortController()
    const key = `${st.id}|${liveLinesKey}`

    const run = async () => {
      const results = await Promise.allSettled(
        liveLines.map((l) => getStationBoard(l.code, st.name.tr, { signal: ac.signal, limit: 4 })),
      )
      if (stopped || reqId !== liveReqId.current) return
      const out: ArrivalRow[] = []
      results.forEach((res, i) => {
        if (res.status === 'fulfilled') out.push(...boardToRows(liveLines[i], res.value))
      })
      out.sort((a, b) => a.etaSec - b.etaSec)
      setLive({ key, rows: out })
    }

    void run()
    const timer = setInterval(() => void run(), LIVE_REFRESH_MS)
    return () => {
      stopped = true
      ac.abort()
      clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st?.id, liveLinesKey])

  // Yalnızca mevcut seçime ait yüklenmiş satırları göster (bayat/başka durak verisi gösterilmez).
  const approaching = live.key === currentKey ? live.rows : []
  const hasLiveSource = liveLines.length > 0
  // Kapsama belirlenene ya da mevcut durağın canlı verisi gelene kadar "yükleniyor" (yanlış sayı yerine).
  const loading =
    (covered === null && servingLines.length > 0) || (hasLiveSource && live.key !== currentKey)

  return { approaching, loading, hasLiveSource }
}
