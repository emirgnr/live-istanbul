import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { useAppStore } from '@/lib/stores/useAppStore'
import { getStation, network } from '@/data'
import { MetroMap, type MetroRoute } from './MetroMap'
import { type MetroStation } from './metroData'
import { edgeD, lineById, nodeById, segmentLineId } from './schemeModel'
import { resolveOur, schemeNodeForOur } from './schemeBridge'
import type { Journey, JourneyPoint } from '@/lib/journey/plan'
import './scheme.css'

/**
 * SchemeMap — the pannable / zoomable relational metro diagram, as a HEADLESS map.
 *
 * It owns ONLY the SVG + camera (viewBox / pan / pinch / wheel) — that pan/zoom code is moved here
 * VERBATIM from the old SchemeView and is do-not-touch. Selection & route are owned by useAppStore
 * (network ids); this map derives its highlight from the store (network→scheme node via
 * schemeNodeForOur) and emits taps UP to the store (scheme node→network via resolveOur). The shared
 * left-sidebar Panel is rendered by App, so both map modes use one panel and one design language.
 */

// ---- do-not-touch camera constants (moved verbatim) ----------------------------------------------
const MAP_W = 4800
const MAP_H = 3450
const FOCAL_X = 2150
const FOCAL_Y = 1330
const INIT_VIEW_W = 2800
const WHEEL_ZOOM_K = 0.0015
const MAX_OUT_FACTOR = Math.exp(WHEEL_ZOOM_K * 100 * 4)
const OVERSCAN = 0.4
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

interface Box {
  x: number
  y: number
  w: number
  h: number
}

const PAN_MARGIN = 520
const PANEL_PX = 400
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

function clampBox(b: Box, viewportW: number): Box {
  const leftSlack = (b.w / Math.max(1, viewportW)) * PANEL_PX
  const minX = CONTENT.minX - leftSlack
  const spanX = CONTENT.maxX - minX
  const spanY = CONTENT.maxY - CONTENT.minY
  const x = b.w >= spanX ? minX + (spanX - b.w) / 2 : clamp(b.x, minX, CONTENT.maxX - b.w)
  const y = b.h >= spanY ? CONTENT.minY + (spanY - b.h) / 2 : clamp(b.y, CONTENT.minY, CONTENT.maxY - b.h)
  return { x, y, w: b.w, h: b.h }
}

/** Bold the chosen route on the drawn lines + A/B endpoints (moved verbatim). */
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
    if (walkPending && last) {
      const na = nodeById[last]
      const nb = nodeById[ids[0]]
      if (na && nb && last !== ids[0]) walks.push({ d: `M ${na.x} ${na.y} L ${nb.x} ${nb.y}` })
    }
    walkPending = false
    for (let i = 0; i < ids.length - 1; i++) {
      const na = nodeById[ids[i]]
      const nb = nodeById[ids[i + 1]]
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

// ---- network line id <-> scheme line id (for dim / fit) -----------------------------------------
const CODE_TO_OUR: Record<string, string> = {}
for (const id in network.lines) {
  const l = network.lines[id]
  if (l.hidden || !l.code) continue
  if (!(l.code in CODE_TO_OUR) || id === l.code) CODE_TO_OUR[l.code] = id
}
const SCHEME_LINE_FOR_OUR: Record<string, string> = {}
const OUR_FOR_SCHEME_LINE: Record<string, string> = {}
for (const slid in lineById) {
  for (const code of lineById[slid].codes ?? []) {
    const our = CODE_TO_OUR[code]
    if (!our) continue
    if (!SCHEME_LINE_FOR_OUR[our]) SCHEME_LINE_FOR_OUR[our] = slid
    if (!OUR_FOR_SCHEME_LINE[slid]) OUR_FOR_SCHEME_LINE[slid] = our
  }
}

/** A scheme node representing a network station JourneyPoint (tries the station's lines). */
function schemeNodeForPoint(p: JourneyPoint | null): string | null {
  if (!p || p.kind !== 'station') return null
  const st = getStation(p.id)
  if (!st) return null
  for (const l of st.lines) {
    const n = schemeNodeForOur(p.id, l)
    if (n) return n
  }
  return null
}

export function SchemeMap() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const sizeRef = useRef({ cw: 1, ch: 1 })
  const fitZRef = useRef(1)
  const initZRef = useRef(1)
  const [box, setBox] = useState<Box>({ x: 0, y: 0, w: MAP_W, h: MAP_H })

  // ---- selection & route come from the shared store (network ids) ----
  const view = useAppStore((s) => s.view)
  const selectedStationId = useAppStore((s) => s.selectedStationId)
  const stationLines = useAppStore((s) => s.stationLines)
  const selectedLineId = useAppStore((s) => s.selectedLineId)
  const journeyFrom = useAppStore((s) => s.journeyFrom)
  const journeyTo = useAppStore((s) => s.journeyTo)
  const journeyPlan = useAppStore((s) => s.journeyPlan)
  const openStation = useAppStore((s) => s.openStation)
  const openLine = useAppStore((s) => s.openLine)
  const setJourneyFrom = useAppStore((s) => s.setJourneyFrom)
  const setJourneyTo = useAppStore((s) => s.setJourneyTo)

  const planning = view === 'journey'

  // network station → the scheme node to highlight (line-scoped, else any of its lines)
  const selNode = useMemo<string | null>(() => {
    if (view !== 'station' || !selectedStationId) return null
    const scoped = stationLines && stationLines.length ? stationLines[0] : null
    if (scoped) {
      const n = schemeNodeForOur(selectedStationId, scoped)
      if (n) return n
    }
    const st = getStation(selectedStationId)
    if (st) for (const l of st.lines) {
      const n = schemeNodeForOur(selectedStationId, l)
      if (n) return n
    }
    return null
  }, [view, selectedStationId, stationLines])

  const selLine = useMemo<string | null>(
    () => (view === 'line' && selectedLineId ? SCHEME_LINE_FOR_OUR[selectedLineId] ?? null : null),
    [view, selectedLineId],
  )

  const routeMetro = useMemo(
    () => (planning && journeyPlan ? buildRoute(journeyPlan) : null),
    [planning, journeyPlan],
  )

  const endpoints = useMemo(() => {
    if (!planning) return null
    const mk = (p: JourneyPoint | null, letter: 'A' | 'B') => {
      const nid = schemeNodeForPoint(p)
      if (!nid) return null
      const n = nodeById[nid]
      return n ? { id: nid, x: n.x, y: n.y, color: n.color, letter } : null
    }
    const a = mk(journeyFrom, 'A')
    const b = mk(journeyTo, 'B')
    return a || b ? { a, b } : null
  }, [planning, journeyFrom, journeyTo])

  // ---- initial fit (do-not-touch) ----
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const fit = () => {
      const cw = el.clientWidth
      const ch = el.clientHeight
      if (!cw || !ch) return
      sizeRef.current = { cw, ch }
      fitZRef.current = Math.max(MAP_W / cw, MAP_H / ch)
      const z = Math.min(fitZRef.current, INIT_VIEW_W / cw)
      initZRef.current = z
      setBox(clampBox({ w: cw * z, h: ch * z, x: FOCAL_X - (cw * z) / 2, y: FOCAL_Y - (ch * z) / 2 }, cw))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ---- camera helpers (do-not-touch) ----
  const focusNode = (id: string) => {
    const n = nodeById[id]
    if (n) setBox((b) => clampBox({ ...b, x: n.x - b.w / 2, y: n.y - b.h / 2 }, sizeRef.current.cw))
  }
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
    const z = clamp(Math.max(bw / cw, bh / ch), fitZRef.current / 12, initZRef.current * MAX_OUT_FACTOR)
    const w = cw * z
    const h = ch * z
    setBox(clampBox({ x: (minX + maxX) / 2 - w / 2, y: (minY + maxY) / 2 - h / 2, w, h }, cw))
  }

  // Pan to the selected station (unless the change came from a direct map tap, which is already
  // on-screen), and fit the selected line — both driven by the store.
  const suppressFocus = useRef(false)
  useEffect(() => {
    if (!selNode) return
    if (suppressFocus.current) {
      suppressFocus.current = false
      return
    }
    focusNode(selNode)
  }, [selNode])
  useEffect(() => {
    if (selLine) fitToLine(selLine)
  }, [selLine])

  // ---- map interactions → store ----
  const onStationTap = (nodeId: string) => {
    const node = nodeById[nodeId]
    if (!node) return
    const ref = resolveOur(node)
    if (!ref) return // unsimulated node — bounded exception: no panel target
    if (planning) {
      const pt: JourneyPoint = { kind: 'station', id: ref.stationId, label: node.name }
      if (!journeyFrom) setJourneyFrom(pt)
      else setJourneyTo(pt)
    } else {
      suppressFocus.current = true
      openStation(ref.stationId, [ref.lineId])
    }
  }
  const onLineTap = (segIndex: number) => {
    const slid = segmentLineId(segIndex)
    if (!slid) return
    const our = OUR_FOR_SCHEME_LINE[slid]
    if (our) openLine(our)
  }

  // ---- pan / zoom via viewBox (moved VERBATIM) ----
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map())
  const pan = useRef<{ sx: number; sy: number; dx: number; dy: number } | null>(null)
  const pinch = useRef<{ startDist: number; cx: number; cy: number; startBox: Box } | null>(null)
  const didDrag = useRef(false)
  const boxRef = useRef(box)
  const pinchRAF = useRef(0)
  const pinchNext = useRef<Box | null>(null)
  const fingerDist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y) || 1

  const onPointerDown = (e: React.PointerEvent) => {
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const n = pointers.current.size
    if (n === 1) {
      pan.current = { sx: e.clientX, sy: e.clientY, dx: 0, dy: 0 }
      didDrag.current = false
    } else if (n === 2) {
      let cur = boxRef.current
      if (pan.current && (pan.current.dx || pan.current.dy)) {
        const z = cur.w / sizeRef.current.cw
        cur = clampBox({ ...cur, x: cur.x - pan.current.dx * z, y: cur.y - pan.current.dy * z }, sizeRef.current.cw)
        setBox(cur)
      }
      if (stageRef.current) stageRef.current.style.transform = 'translate3d(0,0,0)'
      pan.current = null
      const [a, b] = [...pointers.current.values()]
      pinch.current = { startDist: fingerDist(a, b), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, startBox: cur }
      didDrag.current = true
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const pt = pointers.current.get(e.pointerId)
    if (!pt) return
    pt.x = e.clientX
    pt.y = e.clientY

    if (pinch.current) {
      const el = wrapRef.current
      const [a, b] = [...pointers.current.values()]
      if (!el || !a || !b) return
      const rect = el.getBoundingClientRect()
      const { cw, ch } = sizeRef.current
      const p = pinch.current
      const px = p.startBox.x + ((p.cx - rect.left) / rect.width) * p.startBox.w
      const py = p.startBox.y + ((p.cy - rect.top) / rect.height) * p.startBox.h
      const z0 = p.startBox.w / cw
      const nz = clamp((z0 * p.startDist) / fingerDist(a, b), fitZRef.current / 12, initZRef.current * MAX_OUT_FACTOR)
      const nw = cw * nz
      const nh = ch * nz
      const fx = ((a.x + b.x) / 2 - rect.left) / rect.width
      const fy = ((a.y + b.y) / 2 - rect.top) / rect.height
      pinchNext.current = clampBox({ x: px - fx * nw, y: py - fy * nh, w: nw, h: nh }, cw)
      if (!pinchRAF.current) {
        pinchRAF.current = requestAnimationFrame(() => {
          pinchRAF.current = 0
          if (pinchNext.current) setBox(pinchNext.current)
        })
      }
      return
    }

    const d = pan.current
    if (!d) return
    let dx = e.clientX - d.sx
    let dy = e.clientY - d.sy
    if (!didDrag.current && Math.hypot(dx, dy) < 6) return
    didDrag.current = true
    const { cw, ch } = sizeRef.current
    dx = clamp(dx, -OVERSCAN * cw, OVERSCAN * cw)
    dy = clamp(dy, -OVERSCAN * ch, OVERSCAN * ch)
    d.dx = dx
    d.dy = dy
    if (stageRef.current) stageRef.current.style.transform = `translate3d(${dx}px, ${dy}px, 0)`
  }

  const endDrag = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    const n = pointers.current.size
    if (pinch.current) {
      if (n < 2) {
        pinch.current = null
        if (n === 1) {
          const [rest] = [...pointers.current.values()]
          pan.current = { sx: rest.x, sy: rest.y, dx: 0, dy: 0 }
        }
      }
      return
    }
    const d = pan.current
    if (n === 0) pan.current = null
    if (!d || !didDrag.current || n !== 0) return
    const { cw } = sizeRef.current
    const z = boxRef.current.w / cw
    setBox((b) => clampBox({ ...b, x: b.x - d.dx * z, y: b.y - d.dy * z }, cw))
  }

  useEffect(() => () => {
    if (pinchRAF.current) cancelAnimationFrame(pinchRAF.current)
  }, [])

  const onClickCapture = (e: React.MouseEvent) => {
    if (didDrag.current) {
      e.stopPropagation()
      didDrag.current = false
    }
  }
  const zoomBy = (f: number) =>
    setBox((b) => {
      const { cw, ch } = sizeRef.current
      const nz = clamp(b.w / cw / f, fitZRef.current / 12, initZRef.current * MAX_OUT_FACTOR)
      const nw = cw * nz
      const nh = ch * nz
      return clampBox({ w: nw, h: nh, x: b.x + (b.w - nw) / 2, y: b.y + (b.h - nh) / 2 }, cw)
    })

  useLayoutEffect(() => {
    boxRef.current = box
    if (stageRef.current) stageRef.current.style.transform = 'translate3d(0,0,0)'
  }, [box])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onWheelNative = (e: WheelEvent) => {
      const overPanel = (e.target as Element)?.closest?.('.mil-sheet')
      if (overPanel) {
        if (e.ctrlKey) e.preventDefault()
        return
      }
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const { cw, ch } = sizeRef.current
      if (!cw) return
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
    el.addEventListener('wheel', onWheelNative, { passive: false })
    return () => el.removeEventListener('wheel', onWheelNative)
  }, [])

  const zoomedIn = fitZRef.current / (box.w / sizeRef.current.cw || 1)

  const ox = box.w * OVERSCAN
  const oy = box.h * OVERSCAN
  const renderVB = `${box.x - ox} ${box.y - oy} ${box.w + 2 * ox} ${box.h + 2 * oy}`
  const stageStyle: CSSProperties = {
    position: 'absolute',
    left: `${-OVERSCAN * 100}%`,
    top: `${-OVERSCAN * 100}%`,
    width: `${(1 + 2 * OVERSCAN) * 100}%`,
    height: `${(1 + 2 * OVERSCAN) * 100}%`,
    willChange: 'transform',
    transform: 'translate3d(0,0,0)',
  }

  return (
    <div
      className="scheme"
      ref={wrapRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClickCapture={onClickCapture}
    >
      <div className="scheme__stage" ref={stageRef} style={stageStyle}>
        <MetroMap
          viewBox={renderVB}
          preserveAspectRatio="none"
          onStationClick={(st: MetroStation) => onStationTap(st.id)}
          onLineClick={onLineTap}
          selectedStationId={selNode}
          activeLineId={selLine}
          route={planning ? routeMetro : null}
          endpoints={planning ? endpoints : null}
          showLabels={zoomedIn >= 1.2}
        />
      </div>

      <div className="mil-zoom">
        <button type="button" onClick={() => zoomBy(1.3)} aria-label="Yakınlaştır">
          +
        </button>
        <span className="mil-zoom__div" aria-hidden />
        <button type="button" onClick={() => zoomBy(1 / 1.3)} aria-label="Uzaklaştır">
          −
        </button>
      </div>
    </div>
  )
}
