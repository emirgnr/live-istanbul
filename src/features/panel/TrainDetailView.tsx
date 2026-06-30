import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon } from '@/components/Icon'
import { LineBadge } from '@/features/lines/LineBadge'
import { DetailHead, Section } from './ui'
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
      <div className="mil-view">
        <DetailHead
          leading={
            <span className="mil-dhead__icon">
              <Icon name="train" />
            </span>
          }
          title={t('train.title')}
        />
        <p className="mil-empty">{t('train.ended')}</p>
      </div>
    )
  }

  const toward = getStation(detail.towardId)
  const next = detail.upcoming[0]
  const rest = detail.upcoming.slice(1)
  const nextStation = next ? getStation(next.stationId) : null

  return (
    <div className="mil-view" style={{ '--line-color': line.color } as CSSProperties}>
      <DetailHead
        leading={
          <button onClick={() => openLine(line.id)} aria-label={line.name.tr}>
            <LineBadge line={line} size="lg" />
          </button>
        }
        title={toward ? t('train.heading', { station: toward.name.tr }) : line.name.tr}
        sub={
          <>
            <span className={`mil-dot${detail.phase === 'running' ? ' is-on' : ''}`} />
            {detail.phase === 'running' ? t('train.moving') : t('train.atStation')} ·{' '}
            {t(`mode.${line.mode}`)}
          </>
        }
        action={
          <button
            className={`mil-dhead__act mil-dhead__act--follow${follow ? ' is-on' : ''}`}
            onClick={() => setFollow(!follow)}
            aria-pressed={follow}
            title={follow ? t('train.unfollow') : t('train.follow')}
          >
            <Icon name="crosshair" size={18} />
          </button>
        }
      />

      {next && nextStation && (
        <div className="mil-next">
          <span className="mil-next__label">{t('train.nextStop')}</span>
          <button className="mil-next__station" onClick={() => openStation(nextStation.id)}>
            {nextStation.name.tr}
          </button>
          <span className="mil-next__eta">{fmtEta(next.etaSec)}</span>
        </div>
      )}

      {rest.length > 0 && (
        <Section title={t('train.upcoming')}>
          <ol className="mil-stops">
            {rest.map((s, i) => {
              const st = getStation(s.stationId)
              if (!st) return null
              const isLast = i === rest.length - 1
              return (
                <li
                  key={s.stationId}
                  className={`mil-stops__item${isLast ? ' mil-stops__item--end' : ''}`}
                >
                  <button className="mil-stops__btn" onClick={() => openStation(st.id)}>
                    <span className="mil-stops__dot" />
                    <span className="mil-stops__name">
                      <span>{st.name.tr}</span>
                    </span>
                    <span className="mil-stops__eta">{fmtEta(s.etaSec)}</span>
                  </button>
                </li>
              )
            })}
          </ol>
        </Section>
      )}
    </div>
  )
}
