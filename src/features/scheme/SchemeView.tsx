import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useSimStore } from '@/lib/stores/useSimStore'
import { planAlternatives, type Journey } from '@/lib/journey/plan'
import { MetroMap, type MetroRoute } from './MetroMap'
import { type MetroStation } from './metroData'
import { edgeD, lineById, nodeById, segmentLineId } from './schemeModel'
import { resolveOur, schemeNodeForOur } from './schemeBridge'
import {
  SchemeHomeBody,
  SchemeLineBody,
  SchemeNav,
  SchemeRouteBody,
  SchemeStationBody,
  type BackTarget,
} from './SchemeCards'
import './scheme.css'

const MAP_W = 4800
const MAP_H = 3450
const FOCAL_X = 2150 // central Istanbul in scheme coords — initial view centres here, zoomed in
const FOCAL_Y = 1330
const INIT_VIEW_W = 2800 // initial visible width (scheme units) → labels are legible from the start
const WHEEL_ZOOM_K = 0.0015 // wheel sensitivity (per deltaY unit)
// cap zoom-out at ~4 wheel notches beyond the initial framing (≈100 deltaY per notch)
const MAX_OUT_FACTOR = Math.exp(WHEEL_ZOOM_K * 100 * 4)
// the SVG is drawn this much larger than the viewport on every side, so a drag can translate it (GPU-
// composited, no re-render) without revealing blank edges; the pan is baked into the viewBox on release
const OVERSCAN = 0.4
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

/** A layer in the panel's navigation stack. The stack always starts at `home`; drilling pushes a
 *  layer, BACK pops one, HOME resets to `[home]`. The current top also drives the map (selected
 *  station / focused line / route highlight). */
type NavView =
  | { kind: 'home' }
  | { kind: 'line'; lineId: string }
  | { kind: 'station'; nodeId: string }
  | { kind: 'route' }

// the drawn content's extent (+ a comfortable margin for the names beside the dots) — panning is kept
// inside this so the view never drifts off into empty canvas, but with enough room to move freely
const PAN_MARGIN = 520
const PANEL_PX = 400 // left sidebar footprint (panel width + offset) — keep in sync with scheme-card.css
const SCHEME_PEEK = 88 // mobile collapsed peek height (must match --peek in scheme-card.css)
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
 * "Şema" view — a pannable / zoomable relational diagram with a left corporate planner panel. The
 * panel is a single navigation STACK (home → line → station → … → route): tap a dot → its station
 * layer (facilities, transfers, live arrivals, "route from/to"); tap a line → its line layer; set
 * A+B → route options, the selected one drawn bold on the map. BACK retraces one layer, HOME jumps
 * to the line list — so the user always knows where they are and how to return.
 *
 * The map (SVG diagram, station/line drawing, pan/zoom) is intentionally untouched here — only the
 * surrounding chrome (panel, header, zoom controls) is the corporate redesign.
 */
export function SchemeView() {
  const { t } = useTranslation()
  const wrapRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null) // transformed (GPU layer) while dragging
  const cardRef = useRef<HTMLDivElement>(null) // panel scroll container (for scroll save/restore)
  const cardElRef = useRef<HTMLDivElement>(null) // the floating card itself (for the mobile collapse transform)
  const sizeRef = useRef({ cw: 1, ch: 1 })
  const fitZRef = useRef(1)
  const initZRef = useRef(1) // the initial zoom level — zoom-out is capped relative to this
  const [box, setBox] = useState<Box>({ x: 0, y: 0, w: MAP_W, h: MAP_H })
  const clockMs = useSimStore((s) => s.clockMs)

  // ---- panel navigation stack ----
  const [stack, setStack] = useState<NavView[]>([{ kind: 'home' }])
  const [dir, setDir] = useState<'fwd' | 'back'>('fwd')
  // mobile bottom-sheet: collapsed to a peek vs expanded. Inert on desktop (the rail floats).
  const [sheetOpen, setSheetOpen] = useState(false)
  const top = stack[stack.length - 1]
  // remembered scroll offset per stack depth, so BACK lands where the user left off
  const scrollByDepth = useRef<Record<number, number>>({})

  // ---- route planning state (kept while navigating; cleared only by reset) ----
  const [from, setFrom] = useState<RoutePoint | null>(null)
  const [to, setTo] = useState<RoutePoint | null>(null)
  const [options, setOptions] = useState<Journey[]>([])
  const [selOpt, setSelOpt] = useState(0)

  // current map selection is implied by the top layer
  const selNode = top.kind === 'station' ? top.nodeId : null
  const selLine = top.kind === 'line' ? top.lineId : null
  const planning = top.kind === 'route'

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

  // ---- panel navigation helpers ----
  const saveScroll = () => {
    if (cardRef.current) scrollByDepth.current[stack.length] = cardRef.current.scrollTop
  }
  const push = (v: NavView) => {
    saveScroll()
    setDir('fwd')
    setStack((s) => [...s, v])
    setSheetOpen(true) // drilling in (incl. tapping a dot on the map) lifts the mobile sheet
  }
  const back = () => {
    saveScroll()
    setDir('back')
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s))
  }
  const goHome = () => {
    saveScroll()
    setDir('back')
    setStack([{ kind: 'home' }])
  }

  // Mobile bottom-sheet handle: a tap toggles collapsed/expanded, a drag follows the finger
  // and snaps on release. Listens on `window` so the gesture survives the pointer leaving the
  // small grip. Inert on desktop, where the handle is hidden and the card floats as a rail.
  const onHandlePointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const el = cardElRef.current
    if (!el) return
    const startY = e.clientY
    let lastY = e.clientY
    let lastT = e.timeStamp
    let active = false
    const collapsedTranslate = Math.max(0, el.offsetHeight - SCHEME_PEEK)
    const startTranslate = sheetOpen ? 0 : collapsedTranslate

    const move = (ev: PointerEvent) => {
      const dy = ev.clientY - startY
      if (!active) {
        if (Math.abs(dy) < 5) return
        active = true
        el.style.transition = 'none'
      }
      el.style.transform = `translateY(${clamp(startTranslate + dy, 0, collapsedTranslate)}px)`
      lastY = ev.clientY
      lastT = ev.timeStamp
      if (ev.cancelable) ev.preventDefault()
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      el.style.transition = ''
      el.style.transform = ''
      if (!active) {
        setSheetOpen((o) => !o) // a tap toggles
        return
      }
      const dy = ev.clientY - startY
      const vy = (ev.clientY - lastY) / Math.max(1, ev.timeStamp - lastT) // px/ms, +down
      if (vy > 0.4 || dy > 90) setSheetOpen(false)
      else if (vy < -0.4 || dy < -90) setSheetOpen(true)
      else setSheetOpen(startTranslate < collapsedTranslate / 2)
    }
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  // pan the map so a node sits centred (used when navigating to a station FROM the panel — a direct
  // map tap is already on-screen, so it isn't recentred)
  const focusNode = (id: string) => {
    const n = nodeById[id]
    if (n) setBox((b) => clampBox({ ...b, x: n.x - b.w / 2, y: n.y - b.h / 2 }, sizeRef.current.cw))
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

  const openLine = (id: string) => {
    if (top.kind === 'line' && top.lineId === id) return
    push({ kind: 'line', lineId: id })
    fitToLine(id)
  }
  const openStation = (id: string, center: boolean) => {
    if (top.kind === 'station' && top.nodeId === id) return
    push({ kind: 'station', nodeId: id })
    if (center) focusNode(id)
  }
  const enterRoute = () => {
    if (top.kind !== 'route') push({ kind: 'route' })
  }
  const routeFrom = (nodeId: string) => {
    const ref = resolveOur(nodeById[nodeId])
    if (!ref) return
    if (to && to.stationId === ref.stationId) return // origin == destination → ignore
    setFrom({ nodeId, stationId: ref.stationId, label: nodeById[nodeId].name, lineId: nodeById[nodeId].lineId })
    enterRoute()
  }
  const routeTo = (nodeId: string) => {
    const ref = resolveOur(nodeById[nodeId])
    if (!ref) return
    if (from && from.stationId === ref.stationId) return // destination == origin → ignore
    setTo({ nodeId, stationId: ref.stationId, label: nodeById[nodeId].name, lineId: nodeById[nodeId].lineId })
    enterRoute()
  }
  const onStationTap = (id: string) => {
    if (planning) {
      if (!from) routeFrom(id)
      else routeTo(id)
    } else openStation(id, false)
  }

  // after a navigation commits, restore the previous scroll on BACK / start at the top on FORWARD
  useLayoutEffect(() => {
    const el = cardRef.current
    if (el) el.scrollTop = dir === 'back' ? scrollByDepth.current[stack.length] ?? 0 : 0
  }, [stack, dir])

  // ---- pan / zoom via viewBox ----
  const drag = useRef<{ sx: number; sy: number } | null>(null)
  const didDrag = useRef(false)
  const lastDelta = useRef({ dx: 0, dy: 0 })
  const onPointerDown = (e: React.PointerEvent) => {
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    drag.current = { sx: e.clientX, sy: e.clientY }
    didDrag.current = false
    lastDelta.current = { dx: 0, dy: 0 }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    let dx = e.clientX - d.sx
    let dy = e.clientY - d.sy
    if (!didDrag.current && Math.hypot(dx, dy) < 6) return // tolerate jitter so taps still register
    didDrag.current = true
    // translate the (overscanned) SVG layer on the GPU — no React re-render / SVG repaint while dragging
    const { cw, ch } = sizeRef.current
    dx = clamp(dx, -OVERSCAN * cw, OVERSCAN * cw)
    dy = clamp(dy, -OVERSCAN * ch, OVERSCAN * ch)
    lastDelta.current = { dx, dy }
    if (stageRef.current) stageRef.current.style.transform = `translate3d(${dx}px, ${dy}px, 0)`
  }
  const endDrag = () => {
    const d = drag.current
    drag.current = null
    if (!d || !didDrag.current) return
    // bake the drag into the viewBox; the transform is cleared in a layout effect once it commits
    const { cw } = sizeRef.current
    const z = box.w / cw
    const { dx, dy } = lastDelta.current
    setBox((b) => clampBox({ ...b, x: b.x - dx * z, y: b.y - dy * z }, cw))
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

  // once a new viewBox commits, drop any drag transform — no flash, the viewBox already reflects the pan
  useLayoutEffect(() => {
    if (stageRef.current) stageRef.current.style.transform = 'translate3d(0,0,0)'
  }, [box])

  // wheel = zoom the MAP, never the page. A native non-passive listener lets us preventDefault (React's
  // wheel handler is passive), so ctrl+scroll / pinch zooms the diagram instead of the browser page.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const onWheelNative = (e: WheelEvent) => {
      const overPanel = (e.target as Element)?.closest?.('.mil-card')
      if (overPanel) {
        if (e.ctrlKey) e.preventDefault() // block page zoom over the panel, but let it scroll otherwise
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

  // render the map larger than the viewport (overscan) in a composited <div> so a drag-translate of
  // that layer never exposes blank edges and never repaints the SVG
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

  // ---- panel chrome: the layer below the top drives the BACK label; HOME appears once 2+ deep ----
  const prev = stack[stack.length - 2]
  const backTarget: BackTarget | null = !prev
    ? null
    : prev.kind === 'home'
      ? { text: t('home.lines') }
      : prev.kind === 'line'
        ? { lineId: prev.lineId, text: lineById[prev.lineId]?.name ?? '' }
        : prev.kind === 'station'
          ? { lineId: nodeById[prev.nodeId]?.lineId, text: nodeById[prev.nodeId]?.name ?? '' }
          : { text: t('journey.title') }
  const bodyKey = `${stack.length}:${top.kind}:${
    top.kind === 'line' ? top.lineId : top.kind === 'station' ? top.nodeId : ''
  }`
  const stopProp = (e: React.SyntheticEvent) => e.stopPropagation()

  let body: ReactNode
  if (top.kind === 'home') {
    body = <SchemeHomeBody onSelectLine={openLine} onPlanRoute={enterRoute} />
  } else if (top.kind === 'line') {
    body = <SchemeLineBody lineId={top.lineId} onSelectNode={(id) => openStation(id, true)} />
  } else if (top.kind === 'station') {
    body = (
      <SchemeStationBody
        nodeId={top.nodeId}
        clockMs={clockMs}
        onSelectNode={(id) => openStation(id, true)}
        onSelectLine={openLine}
        onRouteFrom={routeFrom}
        onRouteTo={routeTo}
      />
    )
  } else {
    body = (
      <SchemeRouteBody
        from={from}
        to={to}
        onSetFrom={routeFrom}
        onSetTo={routeTo}
        onClearFrom={() => setFrom(null)}
        onClearTo={() => setTo(null)}
        onSwap={() => {
          setFrom(to)
          setTo(from)
        }}
        options={options}
        selected={selOpt}
        onSelect={setSelOpt}
        clockMs={clockMs}
      />
    )
  }

  return (
    <div
      className="scheme"
      ref={wrapRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      onClickCapture={onClickCapture}
    >
      <div className="scheme__stage" ref={stageRef} style={stageStyle}>
        <MetroMap
          viewBox={renderVB}
          preserveAspectRatio="none"
          onStationClick={(st: MetroStation) => onStationTap(st.id)}
          onLineClick={(i) => {
            const lid = segmentLineId(i)
            if (lid) openLine(lid)
          }}
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

      <div
        className={`mil-card${sheetOpen ? ' mil-card--open' : ''}`}
        ref={cardElRef}
        data-view={top.kind}
        onWheel={stopProp}
        onPointerDown={stopProp}
      >
        <button
          type="button"
          className="mil-card__handle"
          onPointerDown={onHandlePointerDown}
          aria-label={t(sheetOpen ? 'panel.collapse' : 'panel.expand')}
        >
          <span className="mil-card__grip" />
        </button>
        <div className="mil-card__scroll" ref={cardRef}>
          {backTarget && <SchemeNav back={backTarget} onBack={back} onHome={stack.length > 2 ? goHome : undefined} />}
          <div className={`mil-card__body mil-card__body--${dir}`} key={bodyKey}>
            {body}
          </div>
        </div>
      </div>
    </div>
  )
}
