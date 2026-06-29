import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { network } from '@/data'
import { useAppStore } from '@/lib/stores/useAppStore'
import { MetroMap } from './MetroMap'
import { LINE_CODES, STATIONS, type MetroStation } from './metroData'
import './scheme.css'

const MAP_W = 4800
const MAP_H = 3450
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

const TR: Record<string, string> = {
  ş: 's', ı: 'i', İ: 'i', ç: 'c', ö: 'o', ü: 'u', ğ: 'g', â: 'a', î: 'i', û: 'u',
}
/** Fold Turkish + punctuation so Yandex labels and our station names compare cleanly. */
const norm = (s: string) =>
  s
    .replace(/[şıİçöüğâîû]/gi, (c) => TR[c.toLowerCase()] ?? c)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

// our station name -> id (built once)
const NAME_TO_ID: Record<string, string> = {}
for (const id in network.stations) {
  const n = network.stations[id]?.name?.tr
  if (n) NAME_TO_ID[norm(n)] = id
}
// our line code -> canonical line id (prefer the line whose id === code; skip hidden sub-lines)
const CODE_TO_OURID: Record<string, string> = {}
for (const id in network.lines) {
  const l = network.lines[id]
  if (l.hidden || !l.code) continue
  if (!(l.code in CODE_TO_OURID) || id === l.code) CODE_TO_OURID[l.code] = id
}
// scheme dot colour -> the line(s) it can mean in our data. Badged lines resolve via their code;
// Marmaray is drawn un-badged in grey, so map it (and the suburban B2) explicitly.
const COLOR_TO_OURIDS: Record<string, string[]> = {}
for (const color in LINE_CODES) {
  COLOR_TO_OURIDS[color] = LINE_CODES[color].map((c) => CODE_TO_OURID[c]).filter(Boolean)
}
COLOR_TO_OURIDS['#585b60'] = ['B1', ...(network.lines['B2'] ? ['B2'] : [])]
// our station id -> a scheme dot (to highlight a station selected elsewhere, e.g. search)
const OURS_TO_SCHEME: Record<string, string> = {}
for (const st of STATIONS) {
  if (!st.name) continue
  const our = NAME_TO_ID[norm(st.name)]
  if (our && !OURS_TO_SCHEME[our]) OURS_TO_SCHEME[our] = st.id
}

interface Box {
  x: number
  y: number
  w: number
  h: number
}

/**
 * "Şema" view — the official Istanbul diagram (MetroMap), made pannable/zoomable by driving the SVG
 * viewBox (so it stays vector-sharp at every zoom, never rasterised). Taps map back to our app: a
 * station that exists in our network opens it; a line focuses it. Live-vehicle overlay shares the
 * same coordinate space (added next).
 */
export function SchemeView() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const sizeRef = useRef({ cw: 1, ch: 1 })
  const fitZRef = useRef(1) // scheme-units per CSS px at "fit whole map"
  const [box, setBox] = useState<Box>({ x: 0, y: 0, w: MAP_W, h: MAP_H })

  const selectedStationId = useAppStore((s) => s.selectedStationId)
  const openStation = useAppStore((s) => s.openStation)
  const [focusColor, setFocusColor] = useState<string | null>(null)
  // highlight the exact dot that was tapped (so M9 Ataköy vs B1 Ataköy stay distinct); fall back to
  // a name match when the station was selected from elsewhere (search / journey).
  const [tapSchemeId, setTapSchemeId] = useState<string | null>(null)
  useEffect(() => {
    if (!selectedStationId) setTapSchemeId(null)
  }, [selectedStationId])
  const selectedSchemeId =
    tapSchemeId ?? (selectedStationId ? OURS_TO_SCHEME[selectedStationId] ?? null : null)

  // keep the window aspect equal to the element aspect (so preserveAspectRatio="none" never distorts)
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const fit = () => {
      const cw = el.clientWidth
      const ch = el.clientHeight
      if (!cw || !ch) return
      sizeRef.current = { cw, ch }
      const z = Math.max(MAP_W / cw, MAP_H / ch) // fit whole map
      fitZRef.current = z
      setBox({ w: cw * z, h: ch * z, x: (MAP_W - cw * z) / 2, y: (MAP_H - ch * z) / 2 })
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Relational open: a scheme dot belongs to ONE line (its colour). Resolve to our station record
  // but scope the detail to just that line, so a shared-name stop only shows its own line's data.
  const onStationClick = (st: MetroStation) => {
    const our = NAME_TO_ID[norm(st.name)]
    if (!our) return
    setTapSchemeId(st.id)
    const ourLines = network.stations[our]?.lines ?? []
    const scoped = (COLOR_TO_OURIDS[st.color] ?? []).filter((id) => ourLines.includes(id))
    openStation(our, scoped.length ? scoped : undefined)
  }

  // ---- pan / zoom via viewBox ----
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)

  const onWheel = (e: React.WheelEvent) => {
    const rect = wrapRef.current?.getBoundingClientRect()
    const { cw, ch } = sizeRef.current
    if (!rect || !cw) return
    const fx = (e.clientX - rect.left) / rect.width
    const fy = (e.clientY - rect.top) / rect.height
    setBox((b) => {
      const z = b.w / cw
      const nz = clamp(z * Math.exp(e.deltaY * 0.0015), fitZRef.current / 10, fitZRef.current * 1.15)
      const nw = cw * nz
      const nh = ch * nz
      const sx = b.x + fx * b.w
      const sy = b.y + fy * b.h
      return { w: nw, h: nh, x: sx - fx * nw, y: sy - fy * nh }
    })
  }
  const onPointerDown = (e: React.PointerEvent) => {
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, moved: false }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!d.moved && Math.hypot(dx, dy) < 4) return
    d.moved = true
    d.x = e.clientX
    d.y = e.clientY
    const z = box.w / sizeRef.current.cw
    setBox((b) => ({ ...b, x: b.x - dx * z, y: b.y - dy * z }))
  }
  const endDrag = () => {
    drag.current = null
  }
  const onClickCapture = (e: React.MouseEvent) => {
    if (drag.current?.moved) e.stopPropagation()
  }

  const zoomBy = (f: number) =>
    setBox((b) => {
      const { cw, ch } = sizeRef.current
      const z = b.w / cw
      const nz = clamp(z / f, fitZRef.current / 10, fitZRef.current * 1.15)
      const nw = cw * nz
      const nh = ch * nz
      return { w: nw, h: nh, x: b.x + (b.w - nw) / 2, y: b.y + (b.h - nh) / 2 }
    })

  const zoomedIn = fitZRef.current / (box.w / sizeRef.current.cw || 1)

  return (
    <div
      className="scheme"
      ref={wrapRef}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      onClickCapture={onClickCapture}
    >
      <MetroMap
        viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
        preserveAspectRatio="none"
        onStationClick={onStationClick}
        onLineClick={(c) => setFocusColor((prev) => (prev === c ? null : c))}
        selectedStationId={selectedSchemeId}
        dimColor={focusColor}
        showLabels={zoomedIn >= 1.35}
      />

      <div className="scheme__zoom">
        <button type="button" onClick={() => zoomBy(1.3)} aria-label="Yakınlaştır">
          +
        </button>
        <button type="button" onClick={() => zoomBy(1 / 1.3)} aria-label="Uzaklaştır">
          −
        </button>
      </div>
    </div>
  )
}
