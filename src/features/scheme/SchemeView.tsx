import { useLayoutEffect, useRef, useState } from 'react'
import { useSimStore } from '@/lib/stores/useSimStore'
import { MetroMap } from './MetroMap'
import { type MetroStation } from './metroData'
import { nodeById, segmentLineId } from './schemeModel'
import { SchemeLineCard, SchemeStationCard } from './SchemeCards'
import './scheme.css'

const MAP_W = 4800
const MAP_H = 3450
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

interface Box {
  x: number
  y: number
  w: number
  h: number
}

/**
 * "Şema" view — the official Istanbul diagram, fully relational and self-contained: every dot is its
 * own per-line node (so clustered interchange dots are each clickable and a shared name like Ataköy
 * stays split by line). Tapping a dot opens that line's station card; tapping a line opens the line
 * card. Pan/zoom drives the SVG viewBox so it stays vector-sharp.
 */
export function SchemeView() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const sizeRef = useRef({ cw: 1, ch: 1 })
  const fitZRef = useRef(1)
  const [box, setBox] = useState<Box>({ x: 0, y: 0, w: MAP_W, h: MAP_H })
  const clockMs = useSimStore((s) => s.clockMs)

  const [selNode, setSelNode] = useState<string | null>(null)
  const [selLine, setSelLine] = useState<string | null>(null)

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const fit = () => {
      const cw = el.clientWidth
      const ch = el.clientHeight
      if (!cw || !ch) return
      sizeRef.current = { cw, ch }
      const z = Math.max(MAP_W / cw, MAP_H / ch)
      fitZRef.current = z
      setBox({ w: cw * z, h: ch * z, x: (MAP_W - cw * z) / 2, y: (MAP_H - ch * z) / 2 })
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const selectNode = (id: string, center = false) => {
    setSelNode(id)
    setSelLine(null)
    if (center) {
      const n = nodeById[id]
      if (n) setBox((b) => ({ ...b, x: n.x - b.w / 2, y: n.y - b.h / 2 }))
    }
  }
  const onStationClick = (st: MetroStation) => selectNode(st.id)
  const onLineClick = (segIndex: number) => {
    const lid = segmentLineId(segIndex)
    if (lid) {
      setSelLine(lid)
      setSelNode(null)
    }
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
        onLineClick={onLineClick}
        selectedStationId={selNode}
        activeLineId={selLine}
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

      {selNode && (
        <SchemeStationCard
          nodeId={selNode}
          clockMs={clockMs}
          onClose={() => setSelNode(null)}
          onSelectNode={(id) => selectNode(id, true)}
          onSelectLine={(id) => {
            setSelLine(id)
            setSelNode(null)
          }}
        />
      )}
      {!selNode && selLine && (
        <SchemeLineCard
          lineId={selLine}
          onClose={() => setSelLine(null)}
          onSelectNode={(id) => selectNode(id, true)}
        />
      )}
    </div>
  )
}
