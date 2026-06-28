import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon } from '@/components/Icon'
import { LineBadge } from '@/features/lines/LineBadge'
import { DetailHeader, Section, Stat } from './ui'
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
  const count = useSimStore((s) =>
    lineId ? familyLineIds(lineId).reduce((n, id) => n + (s.countByLine[id] ?? 0), 0) : 0,
  )

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
  const operating = headway != null
  // Service window is officially closed, but trains spawned before closing are still completing
  // their runs (e.g. Marmaray's 108-min trips finishing past midnight). Keep showing them: the
  // map keeps animating those trains, so the panel must reflect the live count too.
  const finishing = !operating && count > 0
  const active = operating || finishing
  const status = operating ? 'status.running' : finishing ? 'status.finishing' : 'status.closed'

  return (
    <div className="view">
      <DetailHeader fav={fav} onFav={() => toggleFav(lineId)}>
        <LineBadge line={line} size="lg" />
        <div className="detail-title">
          <h2>{line.name.tr}</h2>
          <span className="detail-sub">
            <span className={`status-dot${active ? ' status-dot--on' : ''}`} />
            {t(status)} · {t(`mode.${line.mode}`)}
          </span>
        </div>
      </DetailHeader>

      <div className="stat-grid">
        <Stat icon="train" label={t('line.trainsNow')} value={active ? String(count) : '—'} />
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
        <Stat icon="pin" label={t('line.length')} value={profile ? `${km(profile.totalLengthM)} km` : '—'} />
      </div>

      <Section title={`${t('line.stations')} · ${stations.length}`}>
        <ol className="line-stops" style={{ '--line-color': line.color } as CSSProperties}>
          {stations.map((s) => (
            <li key={s.id} className="line-stop">
              <button className="line-stop__btn" onClick={() => openStation(s.id)}>
                <span className="line-stop__dot" />
                <span className="line-stop__name">
                  {s.name.tr}
                  {s.isTransfer && (
                    <span className="transfer-mark" title={t('station.transfer')}>
                      <Icon name="transfer" size={13} />
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
