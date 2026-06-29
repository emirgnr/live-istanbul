import { useState, type ReactNode } from 'react'
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
import { ICON_SQUARE, ICON_GLYPHS, MAP_ICONS, MARMARAY_LOGO } from './metroIcons'
import { nodeById, segmentLineId } from './schemeModel'
import './metro-map.css'

const BASE = import.meta.env.BASE_URL
// Metrobüs logo isn't in the Yandex source, so it stays a plug-in slot: drop public/logos/metrobus.svg
// and it renders; until then nothing shows (no broken image). Coordinates are in the 4800×3450 space.
const LINE_LOGOS = [
  // both Metrobüs ends, small like the Marmaray mark: above Beylikdüzü Sondurak (363,636) and in the
  // open area by the Söğütlüçeşme end
  { key: 'metrobus-w', href: `${BASE}logos/metrobus.svg`, x: 363, y: 608, w: 40, h: 33 },
  { key: 'metrobus-e', href: `${BASE}logos/metrobus.svg`, x: 2895, y: 1555, w: 40, h: 33 },
]

/** A logo loaded from public/logos/. Hides itself if the file isn't present (no broken-image icon). */
function MapLogo({ href, x, y, w, h }: { href: string; x: number; y: number; w: number; h: number }) {
  const [ok, setOk] = useState(true)
  if (!ok) return null
  return (
    <image
      href={href}
      x={x - w / 2}
      y={y - h / 2}
      width={w}
      height={h}
      preserveAspectRatio="xMidYMid meet"
      onError={() => setOk(false)}
    />
  )
}

// fast lookup so an active route can re-draw its own stops with the EXACT station-dot styling
const stationById = new Map(STATIONS.map((s) => [s.id, s]))


const TRMAP: Record<string, string> = {
  ş: 's', ı: 'i', İ: 'i', ç: 'c', ö: 'o', ü: 'u', ğ: 'g', â: 'a', î: 'i', û: 'u',
}
const norm = (s: string) =>
  s.replace(/[şıİçöüğâîû]/gi, (c) => TRMAP[c.toLowerCase()] ?? c).toLowerCase().replace(/[^a-z0-9]/g, '')

// each label's OWN station cluster: its nearest same-name station, plus only the stations clustered
// with that one at interchange distance. This way an active route lights up the name of the stop it
// passes, but a DISTANT stop that merely shares the name (e.g. Metrobüs Acıbadem vs M4 Acıbadem) does
// not inherit the highlight.
const CLUSTER_PX = 70
const labelStationIds: string[][] = LABELS.map((l) => {
  const text = norm(l.spans.map((s) => s.t).join(''))
  if (!text) return []
  const same = STATIONS.filter((st) => st.name && norm(st.name) === text)
  if (!same.length) return []
  let owner = same[0]
  let best = Infinity
  for (const st of same) {
    const d = Math.hypot(st.x - l.x, st.y - l.y)
    if (d < best) {
      best = d
      owner = st
    }
  }
  return same
    .filter((st) => Math.hypot(st.x - owner.x, st.y - owner.y) <= CLUSTER_PX)
    .map((st) => st.id)
})

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
  /** A planned route line to draw on top (bold path on the real lines; base dimmed). */
  route?: MetroRoute | null
  /** A/B endpoint pins — each shows as soon as that endpoint is picked, independent of a full route. */
  endpoints?: { a?: RouteEndpoint | null; b?: RouteEndpoint | null } | null
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
  /** Walking-transfer connectors between legs — drawn as dotted lines (Yandex's kesik çizgi). */
  walks: { d: string }[]
  /** Scheme-node ids of every stop on the route (board, alight + all in between); the real station
      dots are re-drawn crisply on top of the bold line so they sit exactly, at full strength. */
  stopIds: string[]
}

/** A route endpoint pin (A or B). Its name label is suppressed so the pin reads clean. */
export interface RouteEndpoint {
  id: string
  x: number
  y: number
  color: string
  letter: 'A' | 'B'
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
  endpoints,
  viewBox = VIEWBOX,
  preserveAspectRatio = 'xMidYMid meet',
  children,
}: MetroMapProps) {
  const routeActive = !!route
  const routeStops = route ? new Set(route.stopIds) : null
  const pins = [endpoints?.a, endpoints?.b].filter(Boolean) as RouteEndpoint[]
  const endpointIds = pins.length ? new Set(pins.map((p) => p.id)) : null
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
            opacity={routeActive ? 0.5 : activeLineId && segmentLineId(i) !== activeLineId ? 0.5 : 1}
          />
        ))}
        {SEGMENTS.map((s, i) => (
          <path
            key={`l${i}`}
            className="mm-line"
            d={s.d}
            stroke={s.color}
            strokeWidth={s.w}
            opacity={routeActive ? 0.08 : activeLineId && segmentLineId(i) !== activeLineId ? 0.1 : 1}
            onClick={onLineClick ? () => onLineClick(i) : undefined}
          />
        ))}
      </g>

      {/* interchange markers (white capsules + dashed connectors); faded under an active route so
          only the route's own stops (white dots drawn on top) read as interchanges */}
      <g className="mm-transfers" opacity={routeActive ? 0.1 : 1}>
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

      {/* station dots — white core, line-coloured ring; transfers emphasised. Hidden while a route is
          active: the route overlay re-draws its own stops crisply, so this avoids faded off-route /
          interchange-partner dots sitting just beside the route's transfer dots. */}
      {!routeActive && (
        <g className="mm-stations">
          {STATIONS.map((st) => {
            const sel = st.id === selectedStationId
            const dim = activeLineId && nodeById[st.id]?.lineId !== activeLineId
            const r = st.transfer ? 7 : 5.5
            return (
              <g
                key={st.id}
                className={`mm-st-g${sel ? ' is-sel' : ''}`}
                opacity={dim ? 0.25 : 1}
                onClick={onStationClick ? () => onStationClick(st) : undefined}
              >
                {/* generous transparent hit target so the small dots are easy to tap */}
                <circle className="mm-st-hit" cx={st.x} cy={st.y} r={r + 10} />
                <circle
                  className={`mm-st${st.transfer ? ' is-transfer' : ''}${sel ? ' is-sel' : ''}`}
                  cx={st.x}
                  cy={st.y}
                  r={sel ? r + 2.5 : r}
                  stroke={st.transfer ? 'var(--mm-ink)' : st.color}
                  strokeWidth={st.transfer ? 2.4 : 3}
                />
                {st.name && <title>{st.name}</title>}
              </g>
            )
          })}
        </g>
      )}

      {/* line-number badges — faded under an active route (only the route reads at full strength) */}
      <g className="mm-badges" opacity={routeActive ? 0.1 : 1}>
        {BADGES.map((b, i) => (
          <g key={i} transform={`translate(${b.x - 16} ${b.y - 16})`}>
            <rect width="32" height="32" rx="9" fill={b.color} />
            <text className="mm-badge-text" x="16" y="16">
              {b.code}
            </text>
          </g>
        ))}
      </g>

      {/* map pictograms (airport / bus terminal / railway terminal) extracted from the Yandex source,
          placed at its own coordinates: grey rounded square + white glyph (+ IATA code for airports) */}
      <g className="mm-icons" opacity={routeActive ? 0.1 : 1}>
        {MAP_ICONS.map((ic, i) => (
          <g key={i} transform={`translate(${ic.x} ${ic.y})`}>
            <path className="mm-icon-bg" d={ICON_SQUARE} />
            <g transform="translate(5 5)">
              {ICON_GLYPHS[ic.type]?.map((g, j) => (
                <path key={j} className="mm-icon-glyph" d={g.d} fillOpacity={g.o} />
              ))}
            </g>
            {ic.code && (
              <text className="mm-icon-code" x={30} y={12}>
                {ic.code}
              </text>
            )}
          </g>
        ))}
      </g>

      {/* system logos on their lines: Marmaray vector extracted from the Yandex source at its own
          position; Metrobüs (absent from the source) renders once its file is dropped in */}
      <g className="mm-logos" opacity={routeActive ? 0.1 : 1}>
        <g transform={`translate(${MARMARAY_LOGO.x} ${MARMARAY_LOGO.y})`}>
          {MARMARAY_LOGO.paths.map((p, i) => (
            <path key={i} d={p.d} fill={p.fill} />
          ))}
        </g>
        {LINE_LOGOS.map((l) => (
          <MapLogo key={l.key} href={l.href} x={l.x} y={l.y} w={l.w} h={l.h} />
        ))}
      </g>

      {route && (
        <g className="mm-route">
          {route.paths.map((p, i) => (
            <path key={`rc${i}`} className="mm-route-casing" d={p.d} />
          ))}
          {route.paths.map((p, i) => (
            <path key={`r${i}`} className="mm-route-line" d={p.d} stroke={p.color} />
          ))}
          {route.walks.map((w, i) => (
            <path key={`rw${i}`} className="mm-route-walk" d={w.d} />
          ))}
          {route.stopIds.map((id) => {
            const st = stationById.get(id)
            if (!st) return null
            const r = st.transfer ? 7 : 5.5
            return (
              <circle
                key={`rs${id}`}
                className="mm-route-stop"
                cx={st.x}
                cy={st.y}
                r={r}
                stroke={st.transfer ? 'var(--mm-ink)' : st.color}
                strokeWidth={st.transfer ? 2.4 : 3}
              />
            )
          })}
        </g>
      )}

      {/* A / B endpoint pins — drawn from the picked endpoints, so A appears the moment the start is
          chosen even before a destination exists (and B likewise) */}
      {pins.length > 0 && (
        <g className="mm-route">
          {pins.map((p) => (
            <g key={p.letter} transform={`translate(${p.x} ${p.y})`}>
              <circle className="mm-ab" r={17} fill={p.color} />
              <text className="mm-ab-text" x={0} y={0}>
                {p.letter}
              </text>
            </g>
          ))}
        </g>
      )}

      {/* station name labels — rendered LAST so a name is never hidden under a line (base or route).
          Under an active route the stops it passes show in black; the rest fade. On-route names show
          even when zoomed out (when ordinary labels are hidden). */}
      {(showLabels || routeActive) && (
        <g className="mm-labels">
          {LABELS.map((l, i) => {
            const onRoute = !!routeStops && labelStationIds[i].some((id) => routeStops.has(id))
            // the A/B pins already mark the endpoints (and the panel names them) — drop their labels
            // so the bold name never collides with the pin
            if (endpointIds && labelStationIds[i].some((id) => endpointIds.has(id))) return null
            if (!showLabels && !onRoute) return null
            const opacity = routeActive ? (onRoute ? 1 : 0.12) : 1
            return (
              <text
                key={i}
                x={l.x}
                y={l.y}
                textAnchor={l.anchor === 'end' ? 'end' : 'start'}
                className={`mm-label${l.warning ? ' is-warn' : ''}${onRoute ? ' is-route' : ''}`}
                opacity={opacity}
              >
                {l.spans.map((sp, j) => (
                  <tspan key={j} x={sp.x} dy={sp.dy}>
                    {sp.t}
                  </tspan>
                ))}
              </text>
            )
          })}
        </g>
      )}

      {children}
    </svg>
  )
}
