import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon, type IconName } from '@/components/Icon'
import { LineBadge } from '@/features/lines/LineBadge'
import { useAppStore } from '@/lib/stores/useAppStore'
import { useSimStore } from '@/lib/stores/useSimStore'
import { getLine, getStation, familyLineIds } from '@/data'
import { currentHeadwaySec } from '@/lib/stats'

/** A titled block: a calm uppercase label on a hairline rule, an optional pulsing
 *  dot marking live content. The shared rhythm divider between panel groups. */
export function Section({
  title,
  live,
  children,
}: {
  title: string
  live?: boolean
  children: ReactNode
}) {
  return (
    <section className="mil-section">
      <div className="mil-section__head">
        <h3 className="mil-section__title">{title}</h3>
        {live && <span className="mil-section__live" aria-hidden />}
      </div>
      {children}
    </section>
  )
}

/** The one labelled BACK control, shared by both map modes. Its destination is DERIVED from the
 *  store's ephemeral parent (a station scoped to one line returns to that line; everything else
 *  returns to the home list), so the user always sees WHERE back leads. A Home shortcut appears
 *  only when back doesn't already go home. */
export function PanelNav() {
  const { t } = useTranslation()
  const parentView = useAppStore((s) => s.parentView)
  const parentLineId = useAppStore((s) => s.parentLineId)
  const openHome = useAppStore((s) => s.openHome)
  const openLine = useAppStore((s) => s.openLine)
  const parentLine = parentLineId ? getLine(parentLineId) : null
  const toLine = parentView === 'line' && parentLine
  const label = toLine ? parentLine!.name.tr : t('home.lines')
  return (
    <>
      <button
        className="mil-dhead__back"
        onClick={() => (toLine ? openLine(parentLineId!) : openHome())}
      >
        <Icon name="arrow-left" size={18} />
        {parentLine && <LineBadge line={parentLine} size="sm" />}
        <span className="mil-dhead__back-label">{label}</span>
      </button>
      {toLine && (
        <button className="mil-dhead__home" onClick={openHome} aria-label={t('home.lines')}>
          <Icon name="list" size={18} />
        </button>
      )}
    </>
  )
}

/** The orientation anchor on every drill-in layer: a nav row carrying the labelled BACK + optional
 *  layer action, then a hero with the leading mark and the title block. */
export function DetailHead({
  leading,
  title,
  sub,
  action,
}: {
  leading?: ReactNode
  title: ReactNode
  sub?: ReactNode
  action?: ReactNode
}) {
  return (
    <header className="mil-dhead">
      <div className="mil-dhead__nav">
        <div className="mil-dhead__navleft">
          <PanelNav />
        </div>
        {action && <div className="mil-dhead__action">{action}</div>}
      </div>
      <div className="mil-dhead__hero">
        {leading && <div className="mil-dhead__lead">{leading}</div>}
        <div className="mil-dhead__text">
          <h2 className="mil-dhead__title">{title}</h2>
          {sub && <div className="mil-dhead__sub">{sub}</div>}
        </div>
      </div>
    </header>
  )
}

/** A single key/value stat tile (line detail grid). */
export function Stat({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <div className="mil-stat">
      <Icon name={icon} size={17} className="mil-stat__icon" />
      <span className="mil-stat__value">{value}</span>
      <span className="mil-stat__label">{label}</span>
    </div>
  )
}

/** A facility / info pill. Also consumed by the scheme panel (scoped via
 *  `.mil-card .mil-chip`), so its markup is kept stable. */
export function Chip({ icon, label }: { icon: IconName; label: string }) {
  return (
    <span className="mil-chip">
      <Icon name={icon} size={15} />
      {label}
    </span>
  )
}

/** A line list row: official badge, name, real service status (in-service light or
 *  "closed" from the schedule), chevron. */
export function LineRow({ lineId }: { lineId: string }) {
  const line = getLine(lineId)
  const open = useAppStore((s) => s.openLine)
  const clockMs = useSimStore((s) => s.clockMs)
  const { t } = useTranslation()
  if (!line) return null
  // operating = the line (or one of its sub-services) is within its scheduled hours now
  const operating = familyLineIds(lineId).some((id) => currentHeadwaySec(id, clockMs) != null)
  return (
    <button className="mil-row mil-row--line" onClick={() => open(lineId)}>
      <span className="mil-row__lead">
        <LineBadge line={line} />
      </span>
      <span className="mil-row__main">
        <span className="mil-row__title">{line.name.tr}</span>
      </span>
      {operating ? (
        <span className="mil-row__svc" title={t('status.running')} aria-label={t('status.running')}>
          <i className="mil-row__svcdot" style={{ background: line.color }} />
        </span>
      ) : (
        <span className="mil-row__closed">{t('status.closed')}</span>
      )}
      <Icon name="chevron-right" className="mil-row__chev" size={18} />
    </button>
  )
}

/** A station list row: location pin, name, the lines that serve it, chevron. */
export function StationRow({
  stationId,
  showLines = true,
}: {
  stationId: string
  showLines?: boolean
}) {
  const st = getStation(stationId)
  const open = useAppStore((s) => s.openStation)
  if (!st) return null
  return (
    <button className="mil-row mil-row--station" onClick={() => open(stationId)}>
      <span className="mil-row__lead mil-row__pin">
        <Icon name="pin" size={17} />
      </span>
      <span className="mil-row__main">
        <span className="mil-row__title">{st.name.tr}</span>
        {showLines && (
          <span className="mil-row__badges">
            {st.lines.map((id) => {
              const l = getLine(id)
              return l ? <LineBadge key={id} line={l} size="sm" /> : null
            })}
          </span>
        )}
      </span>
      <Icon name="chevron-right" className="mil-row__chev" size={18} />
    </button>
  )
}
