import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon } from '@/components/Icon'
import { LineBadge } from '@/features/lines/LineBadge'
import { useAppStore } from '@/lib/stores/useAppStore'
import { useSimStore } from '@/lib/stores/useSimStore'
import { displayLine, getStation } from '@/data'
import { trainDetailById } from '@/lib/simulation/engine'
import { toMinutes } from '@/lib/format'

export function TrainDetailView() {
  const { t } = useTranslation()
  const id = useAppStore((s) => s.selectedTrainId)
  const follow = useAppStore((s) => s.followTrain)
  const setFollow = useAppStore((s) => s.setFollowTrain)
  const back = useAppStore((s) => s.openHome)
  const openLine = useAppStore((s) => s.openLine)
  const openStation = useAppStore((s) => s.openStation)
  const clockMs = useSimStore((s) => s.clockMs)

  const detail = useMemo(() => (id ? trainDetailById(clockMs, id) : null), [id, clockMs])

  if (!id) return null
  // a train may belong to a hidden sub-line (e.g. Marmaray's Ataköy–Pendik short-turn) — show
  // it as its parent line (single "Marmaray" identity); the destination still distinguishes it
  const line = detail ? displayLine(detail.lineId) : null

  const fmtEta = (s: number) => (s < 45 ? t('eta.now') : `${toMinutes(s)} ${t('units.min')}`)

  if (!detail || !line) {
    return (
      <div className="view">
        <div className="detail-header">
          <button className="icon-button" onClick={back} aria-label={t('nav.back')}>
            <Icon name="arrow-left" />
          </button>
          <div className="detail-header__content">
            <div className="detail-title">
              <h2>{t('train.title')}</h2>
            </div>
          </div>
        </div>
        <p className="empty">{t('train.ended')}</p>
      </div>
    )
  }

  const toward = getStation(detail.towardId)
  const next = detail.upcoming[0]
  const rest = detail.upcoming.slice(1)
  const nextStation = next ? getStation(next.stationId) : null

  return (
    <div className="view" style={{ '--line-color': line.color } as CSSProperties}>
      <div className="detail-header">
        <button className="icon-button" onClick={back} aria-label={t('nav.back')}>
          <Icon name="arrow-left" />
        </button>
        <div className="detail-header__content">
          <button className="badge-row__btn" onClick={() => openLine(line.id)} aria-label={line.name.tr}>
            <LineBadge line={line} size="lg" />
          </button>
          <div className="detail-title">
            <h2>{toward ? t('train.heading', { station: toward.name.tr }) : line.name.tr}</h2>
            <span className="detail-sub">
              <span className={`status-dot${detail.phase === 'running' ? ' status-dot--on' : ''}`} />
              {detail.phase === 'running' ? t('train.moving') : t('train.atStation')} ·{' '}
              {t(`mode.${line.mode}`)}
            </span>
          </div>
        </div>
        <button
          className={`follow-btn${follow ? ' follow-btn--on' : ''}`}
          onClick={() => setFollow(!follow)}
          aria-pressed={follow}
          title={follow ? t('train.unfollow') : t('train.follow')}
        >
          <Icon name="crosshair" size={18} />
        </button>
      </div>

      {next && nextStation && (
        <div className="train-next">
          <div className="train-next__label">{t('train.nextStop')}</div>
          <button className="train-next__station" onClick={() => openStation(nextStation.id)}>
            {nextStation.name.tr}
          </button>
          <div className="train-next__eta">{fmtEta(next.etaSec)}</div>
        </div>
      )}

      {rest.length > 0 && (
        <section className="section">
          <h3 className="section__title">{t('train.upcoming')}</h3>
          <ol className="train-stops">
            {rest.map((s, i) => {
              const st = getStation(s.stationId)
              if (!st) return null
              const isLast = i === rest.length - 1
              return (
                <li key={s.stationId} className={`train-stop${isLast ? ' train-stop--end' : ''}`}>
                  <button className="train-stop__btn" onClick={() => openStation(st.id)}>
                    <span className="train-stop__dot" />
                    <span className="train-stop__name">{st.name.tr}</span>
                    <span className="train-stop__eta">{fmtEta(s.etaSec)}</span>
                  </button>
                </li>
              )
            })}
          </ol>
        </section>
      )}
    </div>
  )
}
