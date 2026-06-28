import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon, type IconName } from '@/components/Icon'
import { LineBadge } from '@/features/lines/LineBadge'
import { useAppStore } from '@/lib/stores/useAppStore'
import { useSimStore } from '@/lib/stores/useSimStore'
import { getLine, getStation, familyLineIds } from '@/data'
import { currentHeadwaySec } from '@/lib/stats'

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="section">
      <h3 className="section__title">{title}</h3>
      <div className="section__body">{children}</div>
    </section>
  )
}

export function DetailHeader({
  children,
  fav,
  onFav,
}: {
  children: ReactNode
  fav: boolean
  onFav: () => void
}) {
  const { t } = useTranslation()
  const back = useAppStore((s) => s.openHome)
  return (
    <div className="detail-header">
      <button className="icon-button" onClick={back} aria-label={t('nav.back')}>
        <Icon name="arrow-left" />
      </button>
      <div className="detail-header__content">{children}</div>
      <button
        className={`icon-button${fav ? ' icon-button--active' : ''}`}
        onClick={onFav}
        aria-label={t('nav.favorite')}
      >
        <Icon name={fav ? 'star-filled' : 'star'} />
      </button>
    </div>
  )
}

export function Stat({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <div className="stat">
      <Icon name={icon} size={16} className="stat__icon" />
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  )
}

export function Chip({ icon, label }: { icon: IconName; label: string }) {
  return (
    <span className="chip">
      <Icon name={icon} size={15} />
      {label}
    </span>
  )
}

export function LineRow({ lineId }: { lineId: string }) {
  const line = getLine(lineId)
  const open = useAppStore((s) => s.openLine)
  // aggregate the line + its hidden sub-lines (Metrobüs routes, Marmaray short-turns)
  const count = useSimStore((s) => familyLineIds(lineId).reduce((n, id) => n + (s.countByLine[id] ?? 0), 0))
  const live = useSimStore((s) => s.live)
  const clockMs = useSimStore((s) => s.clockMs)
  const { t } = useTranslation()
  if (!line) return null
  const operating = familyLineIds(lineId).some((id) => currentHeadwaySec(id, clockMs) != null)
  return (
    <button className="row" onClick={() => open(lineId)}>
      <LineBadge line={line} />
      <span className="row__main">
        <span className="row__title">{line.name.tr}</span>
      </span>
      {live && operating ? (
        <span className="trains-pill" title={t('line.trainsNow')}>
          <i className="trains-pill__dot" style={{ background: line.color }} />
          {count}
        </span>
      ) : (
        <span className="row__closed">{t('status.closed')}</span>
      )}
      <Icon name="chevron-right" className="row__chev" size={18} />
    </button>
  )
}

export function StationRow({ stationId, showLines = true }: { stationId: string; showLines?: boolean }) {
  const st = getStation(stationId)
  const open = useAppStore((s) => s.openStation)
  if (!st) return null
  return (
    <button className="row" onClick={() => open(stationId)}>
      <span className="row__pin">
        <Icon name="pin" size={17} />
      </span>
      <span className="row__main">
        <span className="row__title">{st.name.tr}</span>
        {showLines && (
          <span className="row__badges">
            {st.lines.map((id) => {
              const l = getLine(id)
              return l ? <LineBadge key={id} line={l} size="sm" /> : null
            })}
          </span>
        )}
      </span>
      <Icon name="chevron-right" className="row__chev" size={18} />
    </button>
  )
}
