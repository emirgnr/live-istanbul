import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon } from '@/components/Icon'
import { LineBadge } from '@/features/lines/LineBadge'
import { Chip, DetailHeader, Section } from './ui'
import { useAppStore } from '@/lib/stores/useAppStore'
import { useSimStore } from '@/lib/stores/useSimStore'
import { getLine, getStation } from '@/data'
import { nextArrivals, trainsAtPlatform } from '@/lib/simulation/engine'
import { toMinutes } from '@/lib/format'
import type { LineMode } from '@/lib/network/types'

// transport modes in display order, for grouping the arrivals by category
const MODE_ORDER: LineMode[] = ['metro', 'marmaray', 'suburban', 'tram', 'funicular', 'cablecar', 'brt']

/** Collapse rows that share a route badge + destination. Routes with their OWN code (Metrobüs's
 *  34G, 34BZ…) stay distinct; sub-lines that share the parent's code (Marmaray short-turns, badged
 *  "B1") collapse by destination so a stop shows one row per destination. */
function dedupByDestination<T extends { lineId: string; towardId: string }>(rows: T[]): T[] {
  const seen = new Set<string>()
  return rows.filter((r) => {
    const key = `${getLine(r.lineId)?.code ?? r.lineId}|${r.towardId}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function StationDetailView() {
  const { t } = useTranslation()
  const stationId = useAppStore((s) => s.selectedStationId)
  const openLine = useAppStore((s) => s.openLine)
  const openJourney = useAppStore((s) => s.openJourney)
  const toggleFav = useAppStore((s) => s.toggleFavStation)
  const fav = useAppStore((s) => (stationId ? s.favorites.stations.includes(stationId) : false))
  const clockMs = useSimStore((s) => s.clockMs)

  const st = stationId ? getStation(stationId) : null
  const arrivals = useMemo(
    () => (stationId ? dedupByDestination(nextArrivals(clockMs, stationId)) : []),
    [stationId, clockMs],
  )
  const atPlatform = useMemo(
    () => (stationId ? dedupByDestination(trainsAtPlatform(clockMs, stationId)) : []),
    [stationId, clockMs],
  )

  if (!st || !stationId) return null
  const acc = st.accessibility ?? {}
  const x = st.extra ?? {}
  const hasFacilities =
    acc.elevator || acc.escalator || acc.stepFree || st.facilities?.length || x.babyRoom || x.masjid

  return (
    <div className="view">
      <DetailHeader fav={fav} onFav={() => toggleFav(stationId)}>
        <span className="station-pin">
          <Icon name="pin" />
        </span>
        <div className="detail-title">
          <h2>{st.name.tr}</h2>
          {st.isTransfer && (
            <span className="detail-sub">
              <Icon name="transfer" size={14} /> {t('station.transfer')}
            </span>
          )}
        </div>
      </DetailHeader>

      <div className="badge-row">
        {st.lines.map((id) => {
          const l = getLine(id)
          return l ? (
            <button key={id} className="badge-row__btn" onClick={() => openLine(id)}>
              <LineBadge line={l} />
            </button>
          ) : null
        })}
      </div>

      <div className="station-actions">
        <button
          className="quick-action"
          onClick={() => openJourney({ kind: 'station', id: stationId, label: st.name.tr }, null)}
        >
          <Icon name="train" size={16} />
          {t('journey.fromHere')}
        </button>
        <button
          className="quick-action"
          onClick={() => openJourney(null, { kind: 'station', id: stationId, label: st.name.tr })}
        >
          <Icon name="pin" size={16} />
          {t('journey.toHere')}
        </button>
      </div>

      {atPlatform.length > 0 && (
        <Section title={t('station.atPlatform')}>
          <ul className="arrivals">
            {atPlatform.map((a, i) => {
              const l = getLine(a.lineId)
              const toward = getStation(a.towardId)
              return (
                <li
                  key={`p-${a.lineId}-${a.direction}-${i}`}
                  className="arrival arrival--platform"
                >
                  {l && <LineBadge line={l} size="sm" />}
                  <span className="arrival__toward">{toward?.name.tr}</span>
                  <span className="arrival__platform">
                    <span className="arrival__platform-dot" />
                    {t('station.platformTag')}
                  </span>
                </li>
              )
            })}
          </ul>
        </Section>
      )}

      {arrivals.length === 0 ? (
        <Section title={t('station.approaching')}>
          <p className="empty">{t('station.noService')}</p>
        </Section>
      ) : (
        // one section per transport category: "Yaklaşan Metro", "Yaklaşan Metrobüs", …
        MODE_ORDER.map((mode) => {
          const rows = arrivals.filter((a) => getLine(a.lineId)?.mode === mode)
          if (!rows.length) return null
          return (
            <Section key={mode} title={t('station.approachingMode', { mode: t(`mode.${mode}`) })}>
              <ul className="arrivals">
                {rows.slice(0, 6).map((a, i) => {
                  const l = getLine(a.lineId)
                  const toward = getStation(a.towardId)
                  return (
                    <li key={`${a.lineId}-${a.direction}-${i}`} className="arrival">
                      {l && <LineBadge line={l} size="sm" />}
                      <span className="arrival__toward">{toward?.name.tr}</span>
                      <span className="arrival__eta">
                        {a.etaSec < 45 ? t('eta.now') : `${toMinutes(a.etaSec)} ${t('units.min')}`}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </Section>
          )
        })
      )}

      {hasFacilities && (
        <Section title={t('station.facilities')}>
          <div className="chips">
            {acc.elevator && (
              <Chip icon="elevator" label={`${t('facility.elevator')}${x.liftCount ? ` · ${x.liftCount}` : ''}`} />
            )}
            {acc.escalator && (
              <Chip
                icon="escalator"
                label={`${t('facility.escalator')}${x.escalatorCount ? ` · ${x.escalatorCount}` : ''}`}
              />
            )}
            {acc.stepFree && <Chip icon="accessible" label={t('facility.accessible')} />}
            {st.facilities?.includes('wc') && <Chip icon="wc" label={t('facility.wc')} />}
            {x.babyRoom && <Chip icon="baby" label={t('facility.baby')} />}
            {x.masjid && <Chip icon="mosque" label={t('facility.masjid')} />}
          </div>
        </Section>
      )}
    </div>
  )
}
