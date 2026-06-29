import type { ReactNode } from 'react'
import {
  VIEWBOX,
  WATER,
  SEGMENTS,
  TRANSFERS,
  STATIONS,
  LABELS,
  BADGES,
  type MetroStation,
} from './metroData'
import { nodeById, segmentLineId } from './schemeModel'
import './metro-map.css'

interface MetroMapProps {
  /** A station dot was tapped. */
  onStationClick?: (s: MetroStation) => void
  /** A line was tapped — receives the tapped segment's index (→ resolve to its scheme line). */
  onLineClick?: (segmentIndex: number) => void
  /** Highlighted station (this map's own station id). */
  selectedStationId?: string | null
  /** When a scheme line id is given, every other line/station is dimmed (precise, per component). */
  activeLineId?: string | null
  /** Show station name labels (usually tied to zoom level). */
  showLabels?: boolean
  /** A planned route to draw on top (bold path on the real lines + A/B endpoints; base dimmed). */
  route?: MetroRoute | null
  /** Visible window in scheme coordinates (for crisp viewBox-based pan/zoom). */
  viewBox?: string
  /** SVG aspect handling; pass "none" when the window aspect already matches the element. */
  preserveAspectRatio?: string
  /** Overlay drawn in the same 4800×3450 coordinate space (e.g. live vehicles). */
  children?: ReactNode
}

export interface MetroRoute {
  /** Bold leg paths, in the line's colour, following the real drawn geometry. */
  paths: { d: string; color: string }[]
  a: [number, number]
  b: [number, number]
  aColor: string
  bColor: string
}

/**
 * Faithful, MODERN re-draw of the official Istanbul rapid-transit scheme. Every coordinate, the
 * viewBox, the line geometry and the colour palette come verbatim from `metroData.ts` (so an overlay
 * lines up 1:1 with the original); only the visual treatment — rounded joints, depth, white-core
 * station dots, crisp typography and hover transitions — is new. It is purely presentational; pan /
 * zoom and data wiring live in the parent.
 */
export function MetroMap({
  onStationClick,
  onLineClick,
  selectedStationId,
  activeLineId,
  showLabels = true,
  route,
  viewBox = VIEWBOX,
  preserveAspectRatio = 'xMidYMid meet',
  children,
}: MetroMapProps) {
  const routeActive = !!route
  return (
    <svg className="mm" viewBox={viewBox} preserveAspectRatio={preserveAspectRatio}>
      {/* Istanbul land / water silhouette. In the source it lives inside a nested <svg x="-10"
          y="-290">, so apply that offset for it to register under the lines (coast, Bosphorus). */}
      <g transform="translate(-10 -290)">
        <path className="mm-water" d={WATER} />
      </g>

      {/* line casings, then the colours on top (two passes → clean shared trunks) */}
      <g className="mm-lines">
        {SEGMENTS.map((s, i) => (
          <path
            key={`c${i}`}
            className="mm-casing"
            d={s.d}
            strokeWidth={s.w + 6}
            opacity={routeActive ? 0.45 : activeLineId && segmentLineId(i) !== activeLineId ? 0.12 : 1}
          />
        ))}
        {SEGMENTS.map((s, i) => (
          <path
            key={`l${i}`}
            className="mm-line"
            d={s.d}
            stroke={s.color}
            strokeWidth={s.w}
            opacity={routeActive ? 0.16 : activeLineId && segmentLineId(i) !== activeLineId ? 0.15 : 1}
            onClick={onLineClick ? () => onLineClick(i) : undefined}
          />
        ))}
      </g>

      {/* interchange markers (white capsules + dashed connectors) */}
      <g className="mm-transfers">
        {TRANSFERS.map((t, i) => (
          <path
            key={i}
            d={t.d}
            fill={t.fill === 'none' ? 'none' : 'var(--mm-surface)'}
            stroke={t.stroke === 'none' ? 'none' : t.stroke === '#000000' ? 'var(--mm-ink)' : 'var(--mm-connector)'}
            strokeWidth={t.w}
            strokeDasharray={t.dash || undefined}
            strokeLinecap="round"
          />
        ))}
      </g>

      {/* station dots — white core, line-coloured ring; transfers emphasised */}
      <g className="mm-stations">
        {STATIONS.map((st) => {
          const sel = st.id === selectedStationId
          const dim = routeActive || (activeLineId && nodeById[st.id]?.lineId !== activeLineId)
          const r = st.transfer ? 7 : 5.5
          return (
            <circle
              key={st.id}
              className={`mm-st${st.transfer ? ' is-transfer' : ''}${sel ? ' is-sel' : ''}`}
              cx={st.x}
              cy={st.y}
              r={sel ? r + 2.5 : r}
              stroke={st.transfer ? 'var(--mm-ink)' : st.color}
              strokeWidth={st.transfer ? 2.4 : 3}
              opacity={dim ? 0.25 : 1}
              onClick={onStationClick ? () => onStationClick(st) : undefined}
            >
              {st.name && <title>{st.name}</title>}
            </circle>
          )
        })}
      </g>

      {/* line-number badges */}
      <g className="mm-badges">
        {BADGES.map((b, i) => (
          <g key={i} transform={`translate(${b.x - 16} ${b.y - 16})`}>
            <rect width="32" height="32" rx="9" fill={b.color} />
            <text className="mm-badge-text" x="16" y="16">
              {b.code}
            </text>
          </g>
        ))}
      </g>

      {/* station name labels */}
      {showLabels && (
        <g className="mm-labels" opacity={routeActive ? 0.3 : 1}>
          {LABELS.map((l, i) => (
            <text
              key={i}
              x={l.x}
              y={l.y}
              textAnchor={l.anchor === 'end' ? 'end' : 'start'}
              className={`mm-label${l.warning ? ' is-warn' : ''}`}
            >
              {l.spans.map((sp, j) => (
                <tspan key={j} x={sp.x} dy={sp.dy}>
                  {sp.t}
                </tspan>
              ))}
            </text>
          ))}
        </g>
      )}

      {route && (
        <g className="mm-route">
          {route.paths.map((p, i) => (
            <path key={`rc${i}`} className="mm-route-casing" d={p.d} />
          ))}
          {route.paths.map((p, i) => (
            <path key={`r${i}`} className="mm-route-line" d={p.d} stroke={p.color} />
          ))}
          <g transform={`translate(${route.a[0]} ${route.a[1]})`}>
            <circle className="mm-ab" r={17} fill={route.aColor} />
            <text className="mm-ab-text" y={1}>
              A
            </text>
          </g>
          <g transform={`translate(${route.b[0]} ${route.b[1]})`}>
            <circle className="mm-ab" r={17} fill={route.bColor} />
            <text className="mm-ab-text" y={1}>
              B
            </text>
          </g>
        </g>
      )}

      {children}
    </svg>
  )
}
