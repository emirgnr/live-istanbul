import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSimStore } from '@/lib/stores/useSimStore'
import { planAlternatives, type Journey } from '@/lib/journey/plan'
import { MetroMap, type MetroRoute } from './MetroMap'
import { type MetroStation } from './metroData'
import { edgeD, lineById, nodeById, segmentLineId } from './schemeModel'
import { resolveOur, schemeNodeForOur } from './schemeBridge'
import { SchemeHomeCard, SchemeLineCard, SchemeRouteCard, SchemeStationCard } from './SchemeCards'
import './scheme.css'

const MAP_W = 4800
const MAP_H = 3450
const FOCAL_X = 2150 // central Istanbul in scheme coords — initial view centres here, zoomed in
const FOCAL_Y = 1330
const INIT_VIEW_W = 2800 // initial visible width (scheme units) → labels are legible from the start
const WHEEL_ZOOM_K = 0.0015 // wheel sensitivity (per deltaY unit)
// cap zoom-out at ~4 wheel notches beyond the initial framing (≈100 deltaY per notch)
const MAX_OUT_FACTOR = Math.exp(WHEEL_ZOOM_K * 100 * 4)
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

interface Box {
  x: number
  y: number
  w: number
  h: number
}
interface RoutePoint {
  nodeId: string
  stationId: string
  label: string
  lineId: string
}

// the drawn content's extent (+ a comfortable margin for the names beside the dots) — panning is kept
// inside this so the view never drifts off into empty canvas, but with enough room to move freely
const PAN_MARGIN = 520
const PANEL_PX = 400 // left sidebar footprint (panel width + offset) — keep in sync with scheme-card.css
const CONTENT = (() => {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const n of Object.values(nodeById)) {
    if (n.x < minX) minX = n.x
    if (n.x > maxX) maxX = n.x
    if (n.y < minY) minY = n.y
    if (n.y > maxY) maxY = n.y
  }
  return { minX: minX - PAN_MARGIN, minY: minY - PAN_MARGIN, maxX: maxX + PAN_MARGIN, maxY: maxY + PAN_MARGIN }
})()

/** Keep the view within the content bounds; centre it when it's larger. The left bound is relaxed by
 *  the panel's width (in scheme units at this zoom) so content can be pulled out from under the panel
 *  — the empty strip that leaves on the left then sits hidden behind the panel, not in the way. */
function clampBox(b: Box, viewportW: number): Box {
  const leftSlack = (b.w / Math.max(1, viewportW)) * PANEL_PX
  const minX = CONTENT.minX - leftSlack
  const spanX = CONTENT.maxX - minX
  const spanY = CONTENT.maxY - CONTENT.minY
  const x = b.w >= spanX ? minX + (spanX - b.w) / 2 : clamp(b.x, minX, CONTENT.maxX - b.w)
  const y = b.h >= spanY ? CONTENT.minY + (spanY - b.h) / 2 : clamp(b.y, CONTENT.minY, CONTENT.maxY - b.h)
  return { x, y, w: b.w, h: b.h }
}

/** Bold the chosen route on the real drawn lines + A/B endpoints. */
function buildRoute(j: Journey): MetroRoute | null {
  const paths: { d: string; color: string }[] = []
  const stopIds: string[] = []
  const walks: { d: string }[] = []
  let first: string | undefined
  let last: string | undefined
  let walkPending = false
  for (const leg of j.legs) {
    if (leg.type === 'walk') {
      walkPending = true
      continue
    }
    if (leg.type !== 'ride') continue
    const ids = leg.stationIds
      .map((sid) => schemeNodeForOur(sid, leg.lineId))
      .filter((x): x is string => Boolean(x))
    if (!ids.length) {
      walkPending = false
      continue
    }
    // a walking transfer preceded this ride → dashed connector from the previous leg's alight node
    // to this leg's board node (the kesik çizgi between e.g. Bakırköy-İncirli ↔ İncirli Metrobüs)
    if (walkPending && last) {
      const na = nodeById[last]
      const nb = nodeById[ids[0]]
      if (na && nb && last !== ids[0]) walks.push({ d: `M ${na.x} ${na.y} L ${nb.x} ${nb.y}` })
    }
    walkPending = false
    for (let i = 0; i < ids.length - 1; i++) {
      const na = nodeById[ids[i]]
      const nb = nodeById[ids[i + 1]]
      // bridge any missing drawn edge with a straight segment so the route stays continuous
      const d = edgeD(ids[i], ids[i + 1]) ?? `M ${na.x} ${na.y} L ${nb.x} ${nb.y}`
      paths.push({ d, color: na.color })
    }
    for (const id of ids) stopIds.push(id)
    if (!first) first = ids[0]
    last = ids[ids.length - 1]
  }
  if (!first || !last) return null
  return { paths, stopIds, walks }
}

/**
 * "Şema" view — relational diagram + a left planner panel. Tap a dot → its line's station card
 * (facilities, transfers, live arrivals, "route from/to"); tap a line → line card; set A+B → several
 * route options, the selected one drawn bold on the map (A/B, rest dimmed).
 */
export function SchemeView() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const sizeRef = useRef({ cw: 1, ch: 1 })
  const fitZRef = useRef(1)
  const initZRef = useRef(1) // the initial zoom level — zoom-out is capped relative to this
  const [box, setBox] = useState<Box>({ x: 0, y: 0, w: MAP_W, h: MAP_H })
  const clockMs = useSimStore((s) => s.clockMs)

  const [selNode, setSelNode] = useState<string | null>(null)
  const [selLine, setSelLine] = useState<string | null>(null)
  const [from, setFrom] = useState<RoutePoint | null>(null)
  const [to, setTo] = useState<RoutePoint | null>(null)
  const [options, setOptions] = useState<Journey[]>([])
  const [selOpt, setSelOpt] = useState(0)
  const [planning, setPlanning] = useState(false)
  const [backLine, setBackLine] = useState<string | null>(null) // line to return to from a station card

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const fit = () => {
      const cw = el.clientWidth
      const ch = el.clientHeight
      if (!cw || !ch) return
      sizeRef.current = { cw, ch }
      fitZRef.current = Math.max(MAP_W / cw, MAP_H / ch)
      // start zoomed in to the centre (so labels read immediately), but never beyond fitting the map
      const z = Math.min(fitZRef.current, INIT_VIEW_W / cw)
      initZRef.current = z
      setBox(clampBox({ w: cw * z, h: ch * z, x: FOCAL_X - (cw * z) / 2, y: FOCAL_Y - (ch * z) / 2 }, cw))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // recompute route options when endpoints change
  useEffect(() => {
    if (from && to) {
      const now = useSimStore.getState().clockMs
      setOptions(
        planAlternatives(
          { kind: 'station', id: from.stationId, label: from.label },
          { kind: 'station', id: to.stationId, label: to.label },
          now,
          3,
        ),
      )
      setSelOpt(0)
    } else {
      setOptions([])
    }
  }, [from, to])

  const routeMetro = useMemo(
    () => (from && to && options[selOpt] ? buildRoute(options[selOpt]) : null),
    [from, to, options, selOpt],
  )

  // A/B pins follow the picked endpoints directly, so each appears the moment it's chosen — the start
  // is pinned even before a destination is set, and vice-versa
  const endpoints = useMemo(() => {
    const mk = (p: RoutePoint | null, letter: 'A' | 'B') => {
      if (!p) return null
      const n = nodeById[p.nodeId]
      return n ? { id: p.nodeId, x: n.x, y: n.y, color: n.color, letter } : null
    }
    const a = mk(from, 'A')
    const b = mk(to, 'B')
    return a || b ? { a, b } : null
  }, [from, to])

  const selectNode = (id: string, center = false) => {
    setSelNode(id)
    setSelLine(null)
    setBackLine(null)
    if (center) {
      const n = nodeById[id]
      if (n) setBox((b) => clampBox({ ...b, x: n.x - b.w / 2, y: n.y - b.h / 2 }, sizeRef.current.cw))
    }
  }
  // open a station from a line card, remembering the line so the station card can go back to it
  const openStationFromLine = (id: string) => {
    const ln = selLine
    selectNode(id, true)
    setBackLine(ln)
  }
  // focus a line: dim others (activeLineId) + zoom/pan to fit its extent
  const fitToLine = (lineId: string) => {
    const ids = lineById[lineId]?.nodeIds ?? []
    if (!ids.length) return
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const id of ids) {
      const n = nodeById[id]
      if (!n) continue
      if (n.x < minX) minX = n.x
      if (n.x > maxX) maxX = n.x
      if (n.y < minY) minY = n.y
      if (n.y > maxY) maxY = n.y
    }
    const { cw, ch } = sizeRef.current
    const bw = maxX - minX + (maxX - minX) * 0.24 + 280
    const bh = maxY - minY + (maxY - minY) * 0.24 + 280
    // zoom so both the line's width and height fit, matching the element aspect
    const z = clamp(Math.max(bw / cw, bh / ch), fitZRef.current / 12, initZRef.current * MAX_OUT_FACTOR)
    const w = cw * z
    const h = ch * z
    setBox(clampBox({ x: (minX + maxX) / 2 - w / 2, y: (minY + maxY) / 2 - h / 2, w, h }, cw))
  }
  const selectLine = (id: string) => {
    setSelLine(id)
    setSelNode(null)
    fitToLine(id)
  }
  const routeFrom = (nodeId: string) => {
    const ref = resolveOur(nodeById[nodeId])
    if (!ref) return
    if (to && to.stationId === ref.stationId) return // origin == destination → ignore
    setFrom({ nodeId, stationId: ref.stationId, label: nodeById[nodeId].name, lineId: nodeById[nodeId].lineId })
    setPlanning(true)
    setSelNode(null)
    setSelLine(null)
  }
  const routeTo = (nodeId: string) => {
    const ref = resolveOur(nodeById[nodeId])
    if (!ref) return
    if (from && from.stationId === ref.stationId) return // destination == origin → ignore
    setTo({ nodeId, stationId: ref.stationId, label: nodeById[nodeId].name, lineId: nodeById[nodeId].lineId })
    setPlanning(true)
    setSelNode(null)
    setSelLine(null)
  }
  const onStationTap = (id: string) => {
    if (planning) {
      if (!from) routeFrom(id)
      else routeTo(id)
    } else selectNode(id)
  }

  // ---- pan / zoom via viewBox ----
  const drag = useRef<{ x: number; y: number } | null>(null)
  const didDrag = useRef(false)
  const onWheel = (e: React.WheelEvent) => {
    const rect = wrapRef.current?.getBoundingClientRect()
    const { cw, ch } = sizeRef.current
    if (!rect || !cw) return
    const fx = (e.clientX - rect.left) / rect.width
    const fy = (e.clientY - rect.top) / rect.height
    setBox((b) => {
      const z = b.w / cw
      const nz = clamp(z * Math.exp(e.deltaY * WHEEL_ZOOM_K), fitZRef.current / 12, initZRef.current * MAX_OUT_FACTOR)
      const nw = cw * nz
      const nh = ch * nz
      return clampBox({ w: nw, h: nh, x: b.x + fx * b.w - fx * nw, y: b.y + fy * b.h - fy * nh }, cw)
    })
  }
  const onPointerDown = (e: React.PointerEvent) => {
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY }
    didDrag.current = false
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!didDrag.current && Math.hypot(dx, dy) < 6) return // tolerate small jitter so taps still register
    didDrag.current = true
    d.x = e.clientX
    d.y = e.clientY
    const z = box.w / sizeRef.current.cw
    setBox((b) => clampBox({ ...b, x: b.x - dx * z, y: b.y - dy * z }, sizeRef.current.cw))
  }
  const endDrag = () => {
    drag.current = null
  }
  // a pan must not also fire a station/line click (capture-phase guard survives until the click)
  const onClickCapture = (e: React.MouseEvent) => {
    if (didDrag.current) {
      e.stopPropagation()
      didDrag.current = false
    }
  }
  const zoomBy = (f: number) =>
    setBox((b) => {
      const { cw, ch } = sizeRef.current
      const nz = clamp((b.w / cw) / f, fitZRef.current / 12, initZRef.current * MAX_OUT_FACTOR)
      const nw = cw * nz
      const nh = ch * nz
      return clampBox({ w: nw, h: nh, x: b.x + (b.w - nw) / 2, y: b.y + (b.h - nh) / 2 }, cw)
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
        onStationClick={(st: MetroStation) => onStationTap(st.id)}
        onLineClick={(i) => {
          const lid = segmentLineId(i)
          if (lid) selectLine(lid)
        }}
        selectedStationId={selNode}
        activeLineId={selLine}
        route={routeMetro}
        endpoints={endpoints}
        showLabels={zoomedIn >= 1.2}
      />

      <div className="scheme__zoom">
        <button type="button" onClick={() => zoomBy(1.3)} aria-label="Yakınlaştır">
          +
        </button>
        <button type="button" onClick={() => zoomBy(1 / 1.3)} aria-label="Uzaklaştır">
          −
        </button>
      </div>

      <div className="scheme__brand" aria-hidden>
        <span className="brand-m">M</span>
        Metro İstanbul
      </div>

      {planning ? (
        <SchemeRouteCard
          from={from}
          to={to}
          onSetFrom={routeFrom}
          onSetTo={routeTo}
          onClearFrom={() => setFrom(null)}
          onClearTo={() => setTo(null)}
          onClose={() => {
            setPlanning(false)
            setFrom(null)
            setTo(null)
          }}
          onSwap={() => {
            setFrom(to)
            setTo(from)
          }}
          options={options}
          selected={selOpt}
          onSelect={setSelOpt}
          clockMs={clockMs}
        />
      ) : selNode ? (
        <SchemeStationCard
          nodeId={selNode}
          clockMs={clockMs}
          onClose={() => {
            setSelNode(null)
            setBackLine(null)
          }}
          onSelectNode={(id) => selectNode(id, true)}
          onSelectLine={selectLine}
          onRouteFrom={routeFrom}
          onRouteTo={routeTo}
          backLineId={backLine}
          onBack={
            backLine
              ? () => {
                  const ln = backLine
                  setBackLine(null)
                  selectLine(ln)
                }
              : undefined
          }
        />
      ) : selLine ? (
        <SchemeLineCard
          lineId={selLine}
          onClose={() => setSelLine(null)}
          onSelectNode={openStationFromLine}
        />
      ) : (
        <SchemeHomeCard onSelectLine={selectLine} onPlanRoute={() => setPlanning(true)} />
      )}
    </div>
  )
}
