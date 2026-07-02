import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon } from '@/components/Icon'
import { LineBadge } from '@/features/lines/LineBadge'
import { DetailHead, Section, Stat } from './ui'
import { useAppStore } from '@/lib/stores/useAppStore'
import { useSimStore } from '@/lib/stores/useSimStore'
import { getLine, profileForLine, stationsForLine, familyLineIds } from '@/data'
import { currentHeadwaySec } from '@/lib/stats'
import { km, toMinutes } from '@/lib/format'

export function LineDetailView() {
  const { t } = useTranslation()
  const lineId = useAppStore((s) => s.selectedLineId)
  const openStation = useAppStore((s) => s.openStation)
  const toggleFav = useAppStore((s) => s.toggleFavLine)
  const fav = useAppStore((s) => (lineId ? s.favorites.lines.includes(lineId) : false))
  const clockMs = useSimStore((s) => s.clockMs)

  if (!lineId) return null
  const line = getLine(lineId)
  if (!line) return null
  const profile = profileForLine(lineId)
  const stations = stationsForLine(lineId)
  // family-aware headway: the most frequent currently-running service in the family (for a shell
  // line like Metrobüs, its own band is just the backbone — the sub-routes run more often)
  const headway = familyLineIds(lineId)
    .map((id) => currentHeadwaySec(id, clockMs))
    .filter((h): h is number => h != null)
    .reduce<number | null>((min, h) => (min == null || h < min ? h : min), null)
  // Real service status from the schedule (the moving-train simulation is gone).
  const operating = headway != null
  const status = operating ? 'status.running' : 'status.closed'

  return (
    <div className="mil-view" style={{ '--line-color': line.color } as CSSProperties}>
      <DetailHead
        leading={<LineBadge line={line} size="lg" />}
        title={line.name.tr}
        sub={
          <>
            <span className={`mil-dot${operating ? ' is-on' : ''}`} />
            {t(status)} · {t(`mode.${line.mode}`)}
          </>
        }
        action={
          <button
            className={`mil-dhead__act mil-dhead__act--fav${fav ? ' is-on' : ''}`}
            onClick={() => toggleFav(lineId)}
            aria-label={t('nav.favorite')}
            aria-pressed={fav}
          >
            <Icon name={fav ? 'star-filled' : 'star'} />
          </button>
        }
      />

      <div className="mil-stats">
        <Stat icon="list" label={t('line.stations')} value={String(stations.length)} />
        <Stat
          icon="clock"
          label={t('line.headway')}
          value={headway ? `${toMinutes(headway)} ${t('units.min')}` : '—'}
        />
        <Stat
          icon="clock"
          label={t('line.hours')}
          value={
            line.firstTime === '00:00' && line.lastTime === '23:59'
              ? t('line.allDay')
              : `${line.firstTime}–${line.lastTime}`
          }
        />
        <Stat
          icon="pin"
          label={t('line.length')}
          value={profile ? `${km(profile.totalLengthM)} km` : '—'}
        />
      </div>

      <Section title={t('line.stations')}>
        <ol className="mil-stops">
          {stations.map((s) => (
            <li key={s.id} className="mil-stops__item">
              <button className="mil-stops__btn" onClick={() => openStation(s.id, [lineId])}>
                <span className="mil-stops__dot" />
                <span className="mil-stops__name">
                  <span>{s.name.tr}</span>
                  {s.isTransfer && (
                    <span className="mil-xfer" title={t('station.transfer')}>
                      <Icon name="transfer" size={12} />
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </Section>
    </div>
  )
}
