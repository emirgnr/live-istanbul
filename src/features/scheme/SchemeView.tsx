import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSimStore } from '@/lib/stores/useSimStore'
import { planAlternatives, type Journey } from '@/lib/journey/plan'
import { MetroMap, type MetroRoute } from './MetroMap'
import { type MetroStation } from './metroData'
import { edgeD, nodeById, segmentLineId } from './schemeModel'
import { resolveOur, schemeNodeForOur } from './schemeBridge'
import { SchemeHomeCard, SchemeLineCard, SchemeRouteCard, SchemeStationCard } from './SchemeCards'
import './scheme.css'

const MAP_W = 4800
const MAP_H = 3450
const FOCAL_X = 2150 // central Istanbul in scheme coords — initial view centres here, zoomed in
const FOCAL_Y = 1330
const INIT_VIEW_W = 2800 // initial visible width (scheme units) → labels are legible from the start
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
}

/** Bold the chosen route on the real drawn lines + A/B endpoints. */
function buildRoute(j: Journey): MetroRoute | null {
  const paths: { d: string; color: string }[] = []
  let first: string | undefined
  let last: string | undefined
  for (const leg of j.legs) {
    if (leg.type !== 'ride') continue
    const ids = leg.stationIds
      .map((sid) => schemeNodeForOur(sid, leg.lineId))
      .filter((x): x is string => Boolean(x))
    for (let i = 0; i < ids.length - 1; i++) {
      const d = edgeD(ids[i], ids[i + 1])
      if (d) paths.push({ d, color: nodeById[ids[i]].color })
    }
    if (ids.length) {
      if (!first) first = ids[0]
      last = ids[ids.length - 1]
    }
  }
  if (!first || !last) return null
  const a = nodeById[first]
  const b = nodeById[last]
  return { paths, a: [a.x, a.y], b: [b.x, b.y], aColor: a.color, bColor: b.color }
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
  const [box, setBox] = useState<Box>({ x: 0, y: 0, w: MAP_W, h: MAP_H })
  const clockMs = useSimStore((s) => s.clockMs)

  const [selNode, setSelNode] = useState<string | null>(null)
  const [selLine, setSelLine] = useState<string | null>(null)
  const [from, setFrom] = useState<RoutePoint | null>(null)
  const [to, setTo] = useState<RoutePoint | null>(null)
  const [options, setOptions] = useState<Journey[]>([])
  const [selOpt, setSelOpt] = useState(0)

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
      setBox({ w: cw * z, h: ch * z, x: FOCAL_X - (cw * z) / 2, y: FOCAL_Y - (ch * z) / 2 })
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

  const routing = !!(from && to)
  const routeMetro = useMemo(
    () => (routing && options[selOpt] ? buildRoute(options[selOpt]) : null),
    [routing, options, selOpt],
  )

  const selectNode = (id: string, center = false) => {
    setSelNode(id)
    setSelLine(null)
    if (center) {
      const n = nodeById[id]
      if (n) setBox((b) => ({ ...b, x: n.x - b.w / 2, y: n.y - b.h / 2 }))
    }
  }
  const routeFrom = (nodeId: string) => {
    const ref = resolveOur(nodeById[nodeId])
    if (!ref) return
    setFrom({ nodeId, stationId: ref.stationId, label: nodeById[nodeId].name })
    setSelNode(null)
    setSelLine(null)
  }
  const routeTo = (nodeId: string) => {
    const ref = resolveOur(nodeById[nodeId])
    if (!ref) return
    setTo({ nodeId, stationId: ref.stationId, label: nodeById[nodeId].name })
    setSelNode(null)
    setSelLine(null)
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
      const nz = clamp(z * Math.exp(e.deltaY * 0.0015), fitZRef.current / 12, fitZRef.current * 1.15)
      const nw = cw * nz
      const nh = ch * nz
      return { w: nw, h: nh, x: b.x + fx * b.w - fx * nw, y: b.y + fy * b.h - fy * nh }
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
    setBox((b) => ({ ...b, x: b.x - dx * z, y: b.y - dy * z }))
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
      const nz = clamp((b.w / cw) / f, fitZRef.current / 12, fitZRef.current * 1.15)
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
        onStationClick={(st: MetroStation) => selectNode(st.id)}
        onLineClick={(i) => {
          const lid = segmentLineId(i)
          if (lid) {
            setSelLine(lid)
            setSelNode(null)
          }
        }}
        selectedStationId={selNode}
        activeLineId={selLine}
        route={routeMetro}
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

      {routing ? (
        <SchemeRouteCard
          options={options}
          selected={selOpt}
          onSelect={setSelOpt}
          fromLabel={from!.label}
          toLabel={to!.label}
          onSwap={() => {
            setFrom(to)
            setTo(from)
          }}
          onReset={() => {
            setFrom(null)
            setTo(null)
          }}
          clockMs={clockMs}
        />
      ) : selNode ? (
        <SchemeStationCard
          nodeId={selNode}
          clockMs={clockMs}
          onClose={() => setSelNode(null)}
          onSelectNode={(id) => selectNode(id, true)}
          onSelectLine={(id) => {
            setSelLine(id)
            setSelNode(null)
          }}
          onRouteFrom={routeFrom}
          onRouteTo={routeTo}
        />
      ) : selLine ? (
        <SchemeLineCard
          lineId={selLine}
          onClose={() => setSelLine(null)}
          onSelectNode={(id) => selectNode(id, true)}
        />
      ) : (
        <SchemeHomeCard
          onSelectLine={(id) => {
            setSelLine(id)
            setSelNode(null)
          }}
        />
      )}
    </div>
  )
}
