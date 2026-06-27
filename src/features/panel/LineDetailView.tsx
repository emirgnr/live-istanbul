import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon } from '@/components/Icon'
import { LineBadge } from '@/features/lines/LineBadge'
import { DetailHeader, Section, Stat } from './ui'
import { useAppStore } from '@/lib/stores/useAppStore'
import { useSimStore } from '@/lib/stores/useSimStore'
import { getLine, profileForLine, stationsForLine } from '@/data'
import { currentHeadwaySec } from '@/lib/stats'
import { km, toMinutes } from '@/lib/format'

export function LineDetailView() {
  const { t } = useTranslation()
  const lineId = useAppStore((s) => s.selectedLineId)
  const openStation = useAppStore((s) => s.openStation)
  const toggleFav = useAppStore((s) => s.toggleFavLine)
  const fav = useAppStore((s) => (lineId ? s.favorites.lines.includes(lineId) : false))
  const clockMs = useSimStore((s) => s.clockMs)
  const count = useSimStore((s) => (lineId ? (s.countByLine[lineId] ?? 0) : 0))

  if (!lineId) return null
  const line = getLine(lineId)
  if (!line) return null
  const profile = profileForLine(lineId)
  const stations = stationsForLine(lineId)
  const headway = currentHeadwaySec(lineId, clockMs)
  const operating = headway != null

  return (
    <div className="view">
      <DetailHeader fav={fav} onFav={() => toggleFav(lineId)}>
        <LineBadge line={line} size="lg" />
        <div className="detail-title">
          <h2>{line.name.tr}</h2>
          <span className="detail-sub">
            <span className={`status-dot${operating ? ' status-dot--on' : ''}`} />
            {operating ? t('status.running') : t('status.closed')} · {t(`mode.${line.mode}`)}
          </span>
        </div>
      </DetailHeader>

      <div className="stat-grid">
        <Stat icon="train" label={t('line.trainsNow')} value={operating ? String(count) : '—'} />
        <Stat
          icon="clock"
          label={t('line.headway')}
          value={headway ? `${toMinutes(headway)} ${t('units.min')}` : '—'}
        />
        <Stat icon="clock" label={t('line.hours')} value={`${line.firstTime}–${line.lastTime}`} />
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
