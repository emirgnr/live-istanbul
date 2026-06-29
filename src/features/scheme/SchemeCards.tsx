import { Fragment, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { familyLineIds, getLine, getStation } from '@/data'
import { nextArrivals } from '@/lib/simulation/engine'
import { currentHeadwaySec } from '@/lib/stats'
import { toMinutes } from '@/lib/format'
import type { Journey, RideLeg } from '@/lib/journey/plan'
import { lineById, nodeById, type SchemeLine, type SchemeNode } from './schemeModel'
import { resolveOur } from './schemeBridge'
import './scheme-card.css'

const COLOR_LABEL: Record<string, string> = { '#585b60': 'Marmaray', '#eede9e': 'TF', '#95aeab': 'T2' }
const lineLabel = (l?: SchemeLine) =>
  l?.codes.length ? l.codes.join(' / ') : l ? COLOR_LABEL[l.color] ?? '•' : '•'

const stop = (e: React.SyntheticEvent) => e.stopPropagation()

function LineChip({ lineId, onClick }: { lineId: string; onClick?: () => void }) {
  const l = lineById[lineId]
  if (!l) return null
  return (
    <button type="button" className="schip" style={{ background: l.color }} onClick={onClick} disabled={!onClick}>
      {lineLabel(l)}
    </button>
  )
}

/** Badge for one of OUR lines (route legs), using its official code + colours. */
function OurBadge({ lineId }: { lineId: string }) {
  const l = getLine(lineId)
  if (!l) return null
  return (
    <span className="schip schip--sm" style={{ background: l.color, color: l.onColor || '#fff' }}>
      {l.code}
    </span>
  )
}

const rideLegs = (j: Journey) => j.legs.filter((l): l is RideLeg => l.type === 'ride')

// ---------------------------------------------------------------------------
// Home card — all scheme lines, grouped by category (the always-on default panel)
// ---------------------------------------------------------------------------
const CAT_ORDER = ['metro', 'marmaray', 'tram', 'funicular', 'cablecar', 'other'] as const
type Cat = (typeof CAT_ORDER)[number]

function categoryOf(l: SchemeLine): Cat {
  const c = l.codes[0]
  if (!c) return l.color === '#585b60' ? 'marmaray' : 'other'
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

export function SchemeHomeCard({ onSelectLine }: { onSelectLine: (id: string) => void }) {
  const { t, i18n } = useTranslation()
  const catName = (c: Cat) =>
    c === 'other' ? (i18n.language === 'tr' ? 'Diğer' : 'Other') : t(`mode.${c}`)
  return (
    <div className="scard scard--home" role="dialog" onWheel={stop} onPointerDown={stop}>
      <h2 className="scard__home-title">{t('home.lines')}</h2>
      {HOME_CATS.map(({ cat, lines }) => (
        <section className="scard__sec" key={cat}>
          <h3>{catName(cat)}</h3>
          <div className="scard__lines">
            {lines.map((l) => (
              <button key={l.id} className="scard__lineitem" onClick={() => onSelectLine(l.id)}>
                <span className="schip" style={{ background: l.color }}>
                  {lineLabel(l)}
                </span>
                <span className="scard__lineitem-name">{l.name}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Station card
// ---------------------------------------------------------------------------
interface StationProps {
  nodeId: string
  clockMs: number
  onClose: () => void
  onSelectNode: (id: string) => void
  onSelectLine: (id: string) => void
  onRouteFrom: (id: string) => void
  onRouteTo: (id: string) => void
}

export function SchemeStationCard({
  nodeId,
  clockMs,
  onClose,
  onSelectNode,
  onSelectLine,
  onRouteFrom,
  onRouteTo,
}: StationProps) {
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
  const facilities: string[] = []
  if (acc.elevator) facilities.push(t('facility.elevator'))
  if (acc.escalator) facilities.push(t('facility.escalator'))
  if (acc.stepFree) facilities.push(t('facility.accessible'))
  if (ourStation?.facilities?.includes('wc')) facilities.push(t('facility.wc'))
  if (ex.babyRoom) facilities.push(t('facility.baby'))
  if (ex.masjid) facilities.push(t('facility.masjid'))

  return (
    <div className="scard" role="dialog" onWheel={stop} onPointerDown={stop}>
      <button className="scard__close" onClick={onClose} aria-label={t('nav.close')}>
        ×
      </button>
      <div className="scard__head">
        <LineChip lineId={node.lineId} onClick={() => onSelectLine(node.lineId)} />
        <div>
          <h2>{node.name}</h2>
          {line && <p className="scard__line-name">{line.name}</p>}
        </div>
      </div>

      <div className="scard__route-actions">
        <button className="scard__rbtn" onClick={() => onRouteFrom(node.id)}>
          <span className="scard__rdot scard__rdot--a" /> {t('journey.fromHere')}
        </button>
        <button className="scard__rbtn" onClick={() => onRouteTo(node.id)}>
          <span className="scard__rdot scard__rdot--b" /> {t('journey.toHere')}
        </button>
      </div>

      {transfers.length > 0 && (
        <section className="scard__sec">
          <h3>{t('station.transfer')}</h3>
          <div className="scard__transfers">
            {transfers.map((n) => (
              <button key={n.id} className="scard__xfer" onClick={() => onSelectNode(n.id)}>
                <LineChip lineId={n.lineId} />
                <span>{n.name}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {arrivals.length > 0 && (
        <section className="scard__sec">
          <h3>{t('station.approaching')}</h3>
          <ul className="scard__arr">
            {arrivals.map((a, i) => (
              <li key={`${a.lineId}-${a.direction}-${i}`}>
                <span className="scard__toward">{getStation(a.towardId)?.name.tr ?? ''}</span>
                <span className="scard__eta">
                  {a.etaSec < 45 ? t('eta.now') : `${toMinutes(a.etaSec)} ${t('units.min')}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {facilities.length > 0 && (
        <section className="scard__sec">
          <h3>{t('station.facilities')}</h3>
          <div className="scard__facs">
            {facilities.map((f) => (
              <span key={f} className="scard__fac">
                {f}
              </span>
            ))}
          </div>
        </section>
      )}

      {node.neighbors.length > 0 && (
        <section className="scard__sec">
          <h3>{t('train.upcoming')}</h3>
          <div className="scard__neighbors">
            {node.neighbors.map((id) => (
              <button key={id} className="scard__nb" onClick={() => onSelectNode(id)}>
                {nodeById[id]?.name}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Line card
// ---------------------------------------------------------------------------
export function SchemeLineCard({
  lineId,
  onClose,
  onSelectNode,
}: {
  lineId: string
  onClose: () => void
  onSelectNode: (id: string) => void
}) {
  const { t } = useTranslation()
  const line = lineById[lineId]
  if (!line) return null
  return (
    <div className="scard" role="dialog" onWheel={stop} onPointerDown={stop}>
      <button className="scard__close" onClick={onClose} aria-label={t('nav.close')}>
        ×
      </button>
      <div className="scard__head">
        <LineChip lineId={line.id} />
        <div>
          <h2>{line.name}</h2>
          <p className="scard__line-name">
            {t('line.stations')}: {line.nodeIds.length}
          </p>
        </div>
      </div>
      <ol className="scard__stops">
        {line.nodeIds.map((id) => {
          const n = nodeById[id]
          if (!n) return null
          return (
            <li key={id}>
              <button onClick={() => onSelectNode(id)}>
                <span className="scard__stopdot" style={{ borderColor: line.color }} />
                {n.name}
                {n.transfers.length > 0 && <span className="scard__xtag">⇄</span>}
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Route card (multiple options + detailed itinerary)
// ---------------------------------------------------------------------------
function RouteLeg({ leg, clockMs }: { leg: RideLeg; clockMs: number }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const l = getLine(leg.lineId)
  const hw = currentHeadwaySec(leg.lineId, clockMs)
  const mid = leg.stationIds.slice(1, -1)
  return (
    <div className="rleg">
      <div className="rleg__line">
        <OurBadge lineId={leg.lineId} />
        <span>{l?.name.tr}</span>
      </div>
      {hw != null && (
        <div className="rleg__meta">
          {t('line.headway')}: <b>{Math.max(1, Math.round(hw / 60))} {t('units.min')}</b>
        </div>
      )}
      {mid.length > 0 && (
        <button className="rleg__more" onClick={() => setOpen((o) => !o)}>
          {mid.length} {t('journey.stops')} {open ? '▴' : '▾'}
        </button>
      )}
      {open && (
        <ul className="rleg__stops">
          {mid.map((s, i) => (
            <li key={i}>{getStation(s)?.name.tr}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

interface RouteProps {
  options: Journey[]
  selected: number
  onSelect: (i: number) => void
  fromLabel: string
  toLabel: string
  onSwap: () => void
  onReset: () => void
  clockMs: number
}

export function SchemeRouteCard({
  options,
  selected,
  onSelect,
  fromLabel,
  toLabel,
  onSwap,
  onReset,
  clockMs,
}: RouteProps) {
  const { t } = useTranslation()
  const sel = options[selected]
  const legs = sel ? rideLegs(sel) : []
  const destName = legs.length ? getStation(legs[legs.length - 1].to)?.name.tr : ''

  return (
    <div className="scard scard--route" role="dialog" onWheel={stop} onPointerDown={stop}>
      <div className="rform">
        <div className="rform__pts">
          <div className="rform__pt">
            <span className="scard__rdot scard__rdot--a" />
            {fromLabel}
          </div>
          <div className="rform__pt">
            <span className="scard__rdot scard__rdot--b" />
            {toLabel}
          </div>
        </div>
        <button className="rform__swap" onClick={onSwap} aria-label={t('journey.swap')}>
          ⇅
        </button>
      </div>
      <button className="rform__reset" onClick={onReset}>
        {t('nav.clear')}
      </button>

      {options.length === 0 ? (
        <p className="scard__empty">{t('journey.noRoute')}</p>
      ) : (
        <>
          <div className="ropts">
            {options.map((o, i) => (
              <button
                key={i}
                className={`ropt${i === selected ? ' is-sel' : ''}`}
                onClick={() => onSelect(i)}
              >
                <div className="ropt__top">
                  <b>
                    {toMinutes(o.totalSec)} {t('units.min')}
                  </b>
                  <span>
                    {o.transfers} {t('journey.transfers')}
                  </span>
                </div>
                <div className="ropt__lines">
                  {rideLegs(o).map((leg, j) => (
                    <Fragment key={j}>
                      {j > 0 && <span className="ropt__arrow">›</span>}
                      <OurBadge lineId={leg.lineId} />
                    </Fragment>
                  ))}
                </div>
              </button>
            ))}
          </div>

          {sel && (
            <div className="rdetail">
              {legs.map((leg, i) => (
                <Fragment key={i}>
                  <div className="rdetail__stn">
                    <b>{getStation(leg.from)?.name.tr}</b>
                  </div>
                  <RouteLeg leg={leg} clockMs={clockMs} />
                  {i < legs.length - 1 && (
                    <div className="rdetail__xfer">{t('station.transfer')}</div>
                  )}
                </Fragment>
              ))}
              <div className="rdetail__stn rdetail__stn--dest">
                <b>{destName}</b>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
