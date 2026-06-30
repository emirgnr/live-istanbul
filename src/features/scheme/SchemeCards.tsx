import { Fragment, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { familyLineIds, getLine, getStation } from '@/data'
import { nextArrivals } from '@/lib/simulation/engine'
import { currentHeadwaySec } from '@/lib/stats'
import { toMinutes } from '@/lib/format'
import { Chip } from '@/features/panel/ui'
import { Icon } from '@/components/Icon'
import type { Journey, RideLeg } from '@/lib/journey/plan'
import { lineById, nodeById, type SchemeLine, type SchemeNode } from './schemeModel'
import { resolveOur, schemeColorForOur } from './schemeBridge'
import { MARMARAY_LOGO } from './metroIcons'
import './scheme-card.css'

/* ===========================================================================
 * Seyir — scheme planner panel. The corporate sidebar over the diagram.
 *
 * The panel is a single navigation STACK owned by SchemeView (home → line →
 * station → … → route). This file holds the presentational pieces:
 *   - shared chrome  : SchemeNav (back / home), Sec (section)
 *   - shared atoms   : LineChip, OurBadge, ABPin, OpLogo, StationMark, CatLogo
 *   - the four bodies: SchemeHomeBody, SchemeLineBody, SchemeStationBody,
 *                      SchemeRouteBody
 * Every body renders only its CONTENT; the outer card shell, the sticky nav and
 * the directional transition live in SchemeView so the chrome is identical on
 * every layer. Tokens come from the always-light corporate layer re-pinned on
 * `.scheme` (see scheme.css).
 * ========================================================================= */

const COLOR_LABEL: Record<string, string> = { '#585b60': 'Marmaray', '#eede9e': 'MB' }
const lineLabel = (l?: SchemeLine) =>
  l?.codes.length ? l.codes.join(' / ') : l ? COLOR_LABEL[l.color] ?? '•' : '•'

// Pick chip text colour by background luminance, so light OFFICIAL line colours (M9 yellow, M6 beige,
// Metrobüs cream …) get dark ink instead of unreadable white — matching Metro İstanbul wayfinding,
// where light lines carry dark text. Saturated / dark lines keep white. Drops the white-text shadow
// when the ink is dark so it doesn't add a faint halo.
const chipDarkInk = '#16222e'
function chipStyle(hex: string): CSSProperties {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16) / 255
  const g = parseInt(h.slice(2, 4), 16) / 255
  const b = parseInt(h.slice(4, 6), 16) / 255
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  const dark = L > 0.55
  return { background: hex, color: dark ? chipDarkInk : '#fff', textShadow: dark ? 'none' : undefined }
}

const TR: Record<string, string> = { ş: 's', ı: 'i', İ: 'i', ç: 'c', ö: 'o', ü: 'u', ğ: 'g', â: 'a', î: 'i', û: 'u' }
const norm = (s: string) =>
  s.replace(/[şıİçöüğâîû]/gi, (c) => TR[c.toLowerCase()] ?? c).toLowerCase().replace(/[^a-z0-9]/g, '')

// nodes that resolve to our live network — searchable endpoints for route planning
const ROUTABLE = Object.values(nodeById)
  .filter((n) => n.name && resolveOur(n))
  .map((n) => ({ id: n.id, name: n.name, lineId: n.lineId }))
function searchRoutable(q: string, limit = 8) {
  const k = norm(q)
  if (k.length < 2) return []
  return ROUTABLE.filter((n) => norm(n.name).includes(k)).slice(0, limit)
}

// ---------------------------------------------------------------------------
// Shared atoms
// ---------------------------------------------------------------------------

/** Official line chip — its colour, with ink chosen for contrast. Decorative when no handler (renders
 *  a <span> so it can nest inside other buttons). */
export function LineChip({ lineId, size, onClick }: { lineId: string; size?: 'sm' | 'lg'; onClick?: () => void }) {
  const l = lineById[lineId]
  if (!l) return null
  const cls = `mil-linechip${size ? ` mil-linechip--${size}` : ''}`
  const style = chipStyle(l.color)
  if (!onClick) {
    return (
      <span className={cls} style={style}>
        {lineLabel(l)}
      </span>
    )
  }
  return (
    <button type="button" className={cls} style={style} onClick={onClick}>
      {lineLabel(l)}
    </button>
  )
}

/** Badge for one of OUR lines (route legs): official code, drawn in the colour the line uses on the
 *  diagram so every badge matches its map line. */
function OurBadge({ lineId }: { lineId: string }) {
  const l = getLine(lineId)
  if (!l) return null
  return (
    <span className="mil-linechip mil-linechip--sm" style={chipStyle(schemeColorForOur(lineId) ?? l.color)}>
      {l.code}
    </span>
  )
}

/** A/B endpoint marker. SVG so the letter is perfectly centred everywhere — identical to the map pins.
 *  Muted until a colour is given. */
function ABPin({
  letter,
  color,
  size = 22,
  colorOnly = false,
}: {
  letter: 'A' | 'B'
  color?: string
  size?: number
  colorOnly?: boolean
}) {
  return (
    <svg className="mil-abpin" width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="12" style={{ fill: color ?? 'var(--text-muted)' }} />
      {!colorOnly && (
        <text x="12" y="12" textAnchor="middle" dominantBaseline="central" className="mil-abpin__t">
          {letter}
        </text>
      )}
    </svg>
  )
}

/** Small "plan a route" glyph (A dot → winding connector → B dot) for the primary action. */
function RouteGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="6" cy="6" r="2.4" fill="currentColor" />
      <circle cx="18" cy="18" r="2.4" fill="currentColor" />
      <path
        d="M6 9v2.5A2.5 2.5 0 0 0 8.5 14H15A3 3 0 0 1 18 17v1"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// operator logo for a station on a given line: Marmaray (grey) → Marmaray mark, BRT → Metrobüs,
// everything else → Metro İstanbul. (Yandex wrongly shows Metro İstanbul on Marmaray; we fix that.)
const LOGO_BASE = import.meta.env.BASE_URL
function StationMark({ lineId }: { lineId: string }) {
  const isMarmaray = schemeColorForOur(lineId) === '#585b60'
  const isBrt = !isMarmaray && getLine(lineId)?.mode === 'brt'
  return (
    <span className="mil-rstn__mark">
      {isMarmaray ? (
        <svg className="mil-rstn__logo" viewBox={MARMARAY_LOGO.vb} width={26} height={15} aria-hidden>
          {MARMARAY_LOGO.paths.map((p, i) => (
            <path key={i} d={p.d} fill={p.fill} />
          ))}
        </svg>
      ) : (
        <img
          className="mil-rstn__logo"
          src={`${LOGO_BASE}logos/${isBrt ? 'metrobus-mark' : 'metro-istanbul'}.svg`}
          alt=""
          height={isBrt ? 17 : 18}
        />
      )}
    </span>
  )
}

/** Just the operator logo at a given height (correct per line) — for compact rows like the option
 *  summary. Marmaray → Marmaray mark, BRT → Metrobüs, else Metro İstanbul. */
function OpLogo({ lineId, h = 15 }: { lineId: string; h?: number }) {
  const isMarmaray = schemeColorForOur(lineId) === '#585b60'
  const isBrt = !isMarmaray && getLine(lineId)?.mode === 'brt'
  if (isMarmaray) {
    const w = Math.round((h * 34.3) / 18.84)
    return (
      <svg className="mil-oplogo" viewBox={MARMARAY_LOGO.vb} width={w} height={h} aria-hidden>
        {MARMARAY_LOGO.paths.map((p, i) => (
          <path key={i} d={p.d} fill={p.fill} />
        ))}
      </svg>
    )
  }
  return (
    <img
      className="mil-oplogo"
      src={`${LOGO_BASE}logos/${isBrt ? 'metrobus-mark' : 'metro-istanbul'}.svg`}
      alt=""
      height={h}
    />
  )
}

// ---------------------------------------------------------------------------
// Shared chrome — navigation bar + section
// ---------------------------------------------------------------------------

/** A back target: the line/station/etc. one step down the stack, shown on the back control so the
 *  user always knows where "back" leads. */
export interface BackTarget {
  /** Optional line id → render its chip beside the label. */
  lineId?: string
  text: string
}

/** Sticky navigation header on every detail layer: a labelled BACK (where it returns to) and, once
 *  the stack is deeper than one level, a HOME shortcut straight to the line list. Same shape and
 *  position on every layer, so the user learns it once. */
export function SchemeNav({
  back,
  onBack,
  onHome,
}: {
  back: BackTarget
  onBack: () => void
  onHome?: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="mil-snav">
      <button type="button" className="mil-snav__back" onClick={onBack}>
        <Icon name="arrow-left" size={17} className="mil-snav__back-icon" />
        {back.lineId && <LineChip lineId={back.lineId} size="sm" />}
        <span className="mil-snav__back-text">{back.text}</span>
      </button>
      {onHome && (
        <button
          type="button"
          className="mil-snav__home"
          onClick={onHome}
          aria-label={t('home.lines')}
          title={t('home.lines')}
        >
          <Icon name="list" size={18} />
        </button>
      )}
    </div>
  )
}

/** A titled section with a calm uppercase label; an optional pulsing dot marks live content. */
function Sec({ title, live, children }: { title: string; live?: boolean; children: ReactNode }) {
  return (
    <section className="mil-sec">
      <h3 className="mil-sec__h">
        {title}
        {live && <span className="mil-sec__live" aria-hidden />}
      </h3>
      {children}
    </section>
  )
}

/** The big title block at the top of a detail layer — answers "where am I". */
function Hero({ chip, title, sub }: { chip?: ReactNode; title: string; sub?: string }) {
  return (
    <header className="mil-hero">
      {chip}
      <div className="mil-hero__text">
        <h2 className="mil-hero__title">{title}</h2>
        {sub && <p className="mil-hero__sub">{sub}</p>}
      </div>
    </header>
  )
}

// ---------------------------------------------------------------------------
// Home — all scheme lines, grouped by category (the root layer)
// ---------------------------------------------------------------------------
const CAT_ORDER = ['metro', 'marmaray', 'tram', 'funicular', 'brt', 'cablecar', 'other'] as const
type Cat = (typeof CAT_ORDER)[number]

function categoryOf(l: SchemeLine): Cat {
  const c = l.codes[0]
  if (!c) return l.color === '#585b60' ? 'marmaray' : l.color === '#eede9e' ? 'brt' : 'other'
  if (c[0] === 'M') return 'metro'
  if (c[0] === 'T') return 'tram'
  if (c[0] === 'F') return 'funicular'
  if (c[0] === 'U') return 'tram'
  return 'other'
}

// dedupe components that share a code-set / colour (e.g. M2 drawn in two pieces) → one list entry
const HOME_CATS: { cat: Cat; lines: SchemeLine[] }[] = (() => {
  const byKey = new Map<string, SchemeLine>()
  for (const l of Object.values(lineById)) {
    const key = l.codes.length ? l.codes.join('/') : l.color
    const ex = byKey.get(key)
    if (!ex || l.nodeIds.length > ex.nodeIds.length) byKey.set(key, l)
  }
  const cats: Partial<Record<Cat, SchemeLine[]>> = {}
  for (const l of byKey.values()) (cats[categoryOf(l)] ??= []).push(l)
  for (const k of Object.keys(cats) as Cat[])
    cats[k]!.sort((a, b) => (a.codes[0] || a.name).localeCompare(b.codes[0] || b.name, 'en', { numeric: true }))
  return CAT_ORDER.filter((c) => cats[c]?.length).map((c) => ({ cat: c, lines: cats[c]! }))
})()

// small system logo shown beside a category label
function CatLogo({ cat }: { cat: Cat }) {
  const base = import.meta.env.BASE_URL
  if (cat === 'metro') return <img className="mil-cat__logo" src={`${base}logos/metro-istanbul.svg`} alt="" />
  if (cat === 'brt') return <img className="mil-cat__logo" src={`${base}logos/metrobus-mark.svg`} alt="" />
  if (cat === 'marmaray')
    return (
      <svg className="mil-cat__logo" viewBox={MARMARAY_LOGO.vb} aria-hidden>
        {MARMARAY_LOGO.paths.map((p, i) => (
          <path key={i} d={p.d} fill={p.fill} />
        ))}
      </svg>
    )
  return null
}

export function SchemeHomeBody({
  onSelectLine,
  onPlanRoute,
}: {
  onSelectLine: (id: string) => void
  onPlanRoute: () => void
}) {
  const { t, i18n } = useTranslation()
  const [q, setQ] = useState('')
  const catName = (c: Cat) =>
    c === 'other' ? (i18n.language === 'tr' ? 'Diğer' : 'Other') : t(`mode.${c}`)
  const nq = norm(q)
  const cats = nq
    ? HOME_CATS.map(({ cat, lines }) => ({
        cat,
        lines: lines.filter(
          (l) => norm(l.name).includes(nq) || l.codes.some((c) => norm(c).includes(nq)),
        ),
      })).filter((g) => g.lines.length)
    : HOME_CATS

  return (
    <>
      <Hero title={t('home.lines')} sub={t('home.network')} />

      <button type="button" className="mil-sbtn mil-sbtn--primary mil-shome__plan" onClick={onPlanRoute}>
        <RouteGlyph />
        {t('journey.plan')}
      </button>

      <div className="mil-sfield mil-sfield--search">
        <Icon name="search" size={17} className="mil-sfield__icon" />
        <input
          className="mil-sfield__input"
          placeholder={t('home.search')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label={t('home.search')}
        />
      </div>

      {cats.length === 0 ? (
        <p className="mil-card__empty">{t('home.noResults')}</p>
      ) : (
        cats.map(({ cat, lines }) => (
          <section className="mil-cat" key={cat}>
            <h3 className="mil-cat__h">
              <CatLogo cat={cat} />
              {catName(cat)}
            </h3>
            <div className="mil-cat__lines">
              {lines.map((l) => (
                <button key={l.id} type="button" className="mil-srow" onClick={() => onSelectLine(l.id)}>
                  <span className="mil-linechip" style={chipStyle(l.color)}>
                    {lineLabel(l)}
                  </span>
                  <span className="mil-srow__name">{l.name}</span>
                  <Icon name="chevron-right" size={17} className="mil-srow__chev" />
                </button>
              ))}
            </div>
          </section>
        ))
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Line — ordered stops on a coloured rail, with interchange chips
// ---------------------------------------------------------------------------

/** The distinct other-line chips you can interchange to at a node (deduped per line). */
function transferLines(node: SchemeNode): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of node.transfers) {
    const n = nodeById[id]
    if (!n || n.lineId === node.lineId || seen.has(n.lineId)) continue
    seen.add(n.lineId)
    out.push(n.lineId)
  }
  return out
}

export function SchemeLineBody({
  lineId,
  onSelectNode,
}: {
  lineId: string
  onSelectNode: (id: string) => void
}) {
  const { t } = useTranslation()
  const line = lineById[lineId]
  if (!line) return null
  return (
    <>
      <Hero
        chip={<LineChip lineId={line.id} size="lg" />}
        title={line.name}
        sub={`${t('line.stations')}: ${line.nodeIds.length}`}
      />
      <ol className="mil-sstops" style={{ '--line-color': line.color } as CSSProperties}>
        {line.nodeIds.map((id) => {
          const n = nodeById[id]
          if (!n) return null
          const xfers = transferLines(n)
          return (
            <li key={id}>
              <button type="button" onClick={() => onSelectNode(id)}>
                <span className="mil-sstops__dot" style={{ borderColor: line.color }} />
                <span className="mil-sstops__name">{n.name}</span>
                {xfers.length > 0 && (
                  <span className="mil-sstops__xfers">
                    {xfers.map((lid) => (
                      <LineChip key={lid} lineId={lid} size="sm" />
                    ))}
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ol>
    </>
  )
}

// ---------------------------------------------------------------------------
// Station — transfers, live arrivals, facilities, neighbours
// ---------------------------------------------------------------------------
export function SchemeStationBody({
  nodeId,
  clockMs,
  onSelectNode,
  onSelectLine,
  onRouteFrom,
  onRouteTo,
}: {
  nodeId: string
  clockMs: number
  onSelectNode: (id: string) => void
  onSelectLine: (id: string) => void
  onRouteFrom: (id: string) => void
  onRouteTo: (id: string) => void
}) {
  const { t } = useTranslation()
  const node: SchemeNode | undefined = nodeById[nodeId]

  const ourStation = useMemo(() => {
    if (!node) return null
    const ref = resolveOur(node)
    return ref ? getStation(ref.stationId) : null
  }, [node])

  const arrivals = useMemo(() => {
    if (!node) return []
    const ref = resolveOur(node)
    if (!ref) return []
    const fam = new Set(familyLineIds(ref.lineId))
    const seen = new Set<string>()
    return nextArrivals(clockMs, ref.stationId)
      .filter((a) => {
        if (!fam.has(a.lineId) || seen.has(a.towardId)) return false
        seen.add(a.towardId)
        return true
      })
      .slice(0, 6)
  }, [node, clockMs])

  if (!node) return null
  const line = lineById[node.lineId]
  const transfers = node.transfers
    .map((id) => nodeById[id])
    .filter(Boolean)
    .filter((n, i, arr) => arr.findIndex((m) => m.lineId === n.lineId) === i)

  const acc = ourStation?.accessibility ?? {}
  const ex = ourStation?.extra ?? {}
  const hasFacilities =
    acc.elevator || acc.escalator || acc.stepFree || ourStation?.facilities?.includes('wc') || ex.babyRoom || ex.masjid

  return (
    <>
      <Hero
        chip={<LineChip lineId={node.lineId} onClick={() => onSelectLine(node.lineId)} />}
        title={node.name}
        sub={line?.name}
      />

      <div className="mil-sactions">
        <button type="button" className="mil-sbtn mil-sbtn--ghost" onClick={() => onRouteFrom(node.id)}>
          <ABPin letter="A" size={18} /> {t('journey.fromHere')}
        </button>
        <button type="button" className="mil-sbtn mil-sbtn--ghost" onClick={() => onRouteTo(node.id)}>
          <ABPin letter="B" size={18} /> {t('journey.toHere')}
        </button>
      </div>

      {arrivals.length > 0 && (
        <Sec title={t('station.approaching')} live>
          <ul className="mil-sarr">
            {arrivals.map((a, i) => (
              <li key={`${a.lineId}-${a.direction}-${i}`}>
                <span className="mil-sarr__toward">{getStation(a.towardId)?.name.tr ?? ''}</span>
                <span className="mil-sarr__eta">
                  {a.etaSec < 45 ? t('eta.now') : `${toMinutes(a.etaSec)} ${t('units.min')}`}
                </span>
              </li>
            ))}
          </ul>
        </Sec>
      )}

      {transfers.length > 0 && (
        <Sec title={t('station.transfer')}>
          <div className="mil-transfers">
            {transfers.map((n) => (
              <button key={n.id} type="button" className="mil-transfer" onClick={() => onSelectNode(n.id)}>
                <LineChip lineId={n.lineId} />
                <span className="mil-transfer__name">{n.name}</span>
                <Icon name="chevron-right" size={16} className="mil-srow__chev" />
              </button>
            ))}
          </div>
        </Sec>
      )}

      {hasFacilities && (
        <Sec title={t('station.facilities')}>
          <div className="mil-chips">
            {acc.elevator && (
              <Chip icon="elevator" label={`${t('facility.elevator')}${ex.liftCount ? ` · ${ex.liftCount}` : ''}`} />
            )}
            {acc.escalator && (
              <Chip
                icon="escalator"
                label={`${t('facility.escalator')}${ex.escalatorCount ? ` · ${ex.escalatorCount}` : ''}`}
              />
            )}
            {acc.stepFree && <Chip icon="accessible" label={t('facility.accessible')} />}
            {ourStation?.facilities?.includes('wc') && <Chip icon="wc" label={t('facility.wc')} />}
            {ex.babyRoom && <Chip icon="baby" label={t('facility.baby')} />}
            {ex.masjid && <Chip icon="mosque" label={t('facility.masjid')} />}
          </div>
        </Sec>
      )}

      {node.neighbors.length > 0 && (
        <Sec title={t('station.neighbors')}>
          <div className="mil-nbs">
            {node.neighbors.map((id) => (
              <button key={id} type="button" className="mil-nb" onClick={() => onSelectNode(id)}>
                {nodeById[id]?.name}
              </button>
            ))}
          </div>
        </Sec>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Route — A/B form, options, detailed itinerary
// ---------------------------------------------------------------------------
const rideLegs = (j: Journey) => j.legs.filter((l): l is RideLeg => l.type === 'ride')

/** One ride leg on the itinerary rail: line + headway + an expandable list of in-between stops. */
function RouteLeg({ leg, clockMs }: { leg: RideLeg; clockMs: number }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const l = getLine(leg.lineId)
  const hw = currentHeadwaySec(leg.lineId, clockMs)
  const mid = leg.stationIds.slice(1, -1)
  return (
    <div className="mil-rleg" style={{ borderLeftColor: schemeColorForOur(leg.lineId) ?? l?.color }}>
      <div className="mil-rleg__line">
        <OurBadge lineId={leg.lineId} />
        <span>{l?.name.tr}</span>
      </div>
      {hw != null && (
        <div className="mil-rleg__meta">
          {t('line.headway')}: <b>{Math.max(1, Math.round(hw / 60))} {t('units.min')}</b>
        </div>
      )}
      {mid.length > 0 && (
        <button type="button" className="mil-rleg__more" onClick={() => setOpen((o) => !o)}>
          {mid.length} {t('journey.stops')} {open ? '▴' : '▾'}
        </button>
      )}
      {open && (
        <ul className="mil-rleg__stops">
          {mid.map((s, i) => (
            <li key={i}>{getStation(s)?.name.tr}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Spacious vertical itinerary: each stop carries its operator logo; legs show line + headway + stops;
 *  walking transfers get a walk row. */
function RouteDetail({ journey, clockMs }: { journey: Journey; clockMs: number }) {
  const { t } = useTranslation()
  const rides = rideLegs(journey)
  const destLeg = rides[rides.length - 1]
  const rows: ReactNode[] = []
  let prevLine = ''
  journey.legs.forEach((leg, i) => {
    if (leg.type === 'ride') {
      prevLine = leg.lineId
      rows.push(
        <div className="mil-rstn" key={`s${i}`}>
          <StationMark lineId={leg.lineId} />
          <span className="mil-rstn__name">{getStation(leg.from)?.name.tr}</span>
        </div>,
        <RouteLeg key={`l${i}`} leg={leg} clockMs={clockMs} />,
      )
    } else if (leg.type === 'walk') {
      rows.push(
        <div className="mil-rstn" key={`s${i}`}>
          <StationMark lineId={prevLine} />
          <span className="mil-rstn__name">{getStation(leg.from)?.name.tr}</span>
        </div>,
        <div className="mil-rwalk" key={`w${i}`}>
          <Icon name="walk" size={18} />
          <span>
            <b>
              {toMinutes(leg.walkSec)} {t('units.min')}
            </b>{' '}
            · {t('journey.walkTransfer')}
          </span>
        </div>,
      )
    }
  })
  if (destLeg)
    rows.push(
      <div className="mil-rstn mil-rstn--dest" key="dest">
        <StationMark lineId={destLeg.lineId} />
        <span className="mil-rstn__name">{getStation(destLeg.to)?.name.tr}</span>
      </div>,
    )
  return <div className="mil-rdetail">{rows}</div>
}

interface RoutePt {
  label: string
  lineId?: string
}

/** A/B field: shows the picked stop with a clear button, or a search input with live results. */
function RouteField({
  point,
  placeholder,
  onPick,
  onClear,
}: {
  point: RoutePt | null
  placeholder: string
  onPick: (id: string) => void
  onClear: () => void
}) {
  const { t } = useTranslation()
  const [q, setQ] = useState('')
  if (point) {
    return (
      <div className="mil-rfield mil-rfield--set">
        <span className="mil-rfield__label">{point.label}</span>
        <button type="button" className="mil-rfield__x" onClick={onClear} aria-label={t('nav.clear')}>
          <Icon name="x" size={15} />
        </button>
      </div>
    )
  }
  const res = searchRoutable(q)
  return (
    <div className="mil-rfield">
      <input
        className="mil-sfield__input"
        placeholder={placeholder}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label={placeholder}
      />
      {res.length > 0 && (
        <ul className="mil-rfield__res">
          {res.map((r) => {
            const l = lineById[r.lineId]
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(r.id)
                    setQ('')
                  }}
                >
                  {l && <LineChip lineId={r.lineId} size="sm" />}
                  <span className="mil-rfield__resname">{r.name}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

interface RouteProps {
  from: RoutePt | null
  to: RoutePt | null
  onSetFrom: (nodeId: string) => void
  onSetTo: (nodeId: string) => void
  onClearFrom: () => void
  onClearTo: () => void
  onSwap: () => void
  options: Journey[]
  selected: number
  onSelect: (i: number) => void
  clockMs: number
}

export function SchemeRouteBody({
  from,
  to,
  onSetFrom,
  onSetTo,
  onClearFrom,
  onClearTo,
  onSwap,
  options,
  selected,
  onSelect,
  clockMs,
}: RouteProps) {
  const { t, i18n } = useTranslation()
  const sel = options[selected]
  const hint = i18n.language === 'tr' ? 'Haritadan durak seçin ya da arayın' : 'Pick stops on the map or search'

  return (
    <>
      <Hero title={t('journey.title')} />

      <div className="mil-rplan">
        <div className="mil-rplan__pts">
          <div className="mil-rplan__row">
            <ABPin letter="A" colorOnly size={15} color={from?.lineId ? lineById[from.lineId]?.color : undefined} />
            <RouteField point={from} placeholder={t('journey.from')} onPick={onSetFrom} onClear={onClearFrom} />
          </div>
          <div className="mil-rplan__row">
            <ABPin letter="B" colorOnly size={15} color={to?.lineId ? lineById[to.lineId]?.color : undefined} />
            <RouteField point={to} placeholder={t('journey.to')} onPick={onSetTo} onClear={onClearTo} />
          </div>
        </div>
        <button
          type="button"
          className="mil-rplan__swap"
          onClick={onSwap}
          aria-label={t('journey.swap')}
          title={t('journey.swap')}
          disabled={!from && !to}
        >
          <Icon name="swap" size={18} />
        </button>
      </div>

      {(from || to) && (
        <button
          type="button"
          className="mil-sbtn mil-sbtn--reset"
          onClick={() => {
            onClearFrom()
            onClearTo()
          }}
        >
          <Icon name="x" size={14} /> {t('journey.reset')}
        </button>
      )}

      {!from || !to ? (
        <p className="mil-card__empty">{hint}</p>
      ) : options.length === 0 ? (
        <p className="mil-card__empty">{t('journey.noRoute')}</p>
      ) : (
        <>
          <div className="mil-ropts">
            {options.map((o, i) => (
              <button
                key={i}
                type="button"
                className={`mil-ropt${i === selected ? ' is-sel' : ''}`}
                onClick={() => onSelect(i)}
                aria-pressed={i === selected}
              >
                <div className="mil-ropt__top">
                  <b>
                    {toMinutes(o.totalSec)} {t('units.min')}
                  </b>
                  <span>
                    {o.transfers} {t('journey.transfers')}
                  </span>
                </div>
                <div className="mil-ropt__lines">
                  {rideLegs(o).map((leg, j) => (
                    <Fragment key={j}>
                      {j > 0 && <span className="mil-ropt__arrow">›</span>}
                      <span className="mil-ropt__leg">
                        <OpLogo lineId={leg.lineId} />
                        <OurBadge lineId={leg.lineId} />
                      </span>
                    </Fragment>
                  ))}
                </div>
              </button>
            ))}
          </div>

          {sel && <RouteDetail journey={sel} clockMs={clockMs} />}
        </>
      )}
    </>
  )
}
