import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon } from '@/components/Icon'
import { LineBadge } from '@/features/lines/LineBadge'
import { DetailHead, Section } from './ui'
import { useAppStore } from '@/lib/stores/useAppStore'
import { useSimStore } from '@/lib/stores/useSimStore'
import { familyLineIds, getLine, getStation } from '@/data'
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
  const stationLines = useAppStore((s) => s.stationLines)
  const openLine = useAppStore((s) => s.openLine)
  const openJourney = useAppStore((s) => s.openJourney)
  const toggleFav = useAppStore((s) => s.toggleFavStation)
  const fav = useAppStore((s) => (stationId ? s.favorites.stations.includes(stationId) : false))
  const clockMs = useSimStore((s) => s.clockMs)

  const st = stationId ? getStation(stationId) : null
  // when the scheme scopes the view to specific line(s), only show those (+ their hidden sub-lines)
  const allowed = useMemo(
    () =>
      stationLines && stationLines.length
        ? new Set(stationLines.flatMap((id) => familyLineIds(id)))
        : null,
    [stationLines],
  )
  const arrivals = useMemo(() => {
    if (!stationId) return []
    let rows = nextArrivals(clockMs, stationId)
    if (allowed) rows = rows.filter((r) => allowed.has(r.lineId))
    return dedupByDestination(rows)
  }, [stationId, clockMs, allowed])
  const atPlatform = useMemo(() => {
    if (!stationId) return []
    let rows = trainsAtPlatform(clockMs, stationId)
    if (allowed) rows = rows.filter((r) => allowed.has(r.lineId))
    return dedupByDestination(rows)
  }, [stationId, clockMs, allowed])

  if (!st || !stationId) return null
  const acc = st.accessibility ?? {}
  const x = st.extra ?? {}
  const hasFacilities =
    acc.elevator || acc.escalator || acc.stepFree || st.facilities?.length || x.babyRoom || x.masjid

  return (
    <div className="mil-view">
      <DetailHead
        leading={
          <span className="mil-dhead__icon">
            <Icon name="pin" />
          </span>
        }
        title={st.name.tr}
        sub={
          st.isTransfer ? (
            <>
              <Icon name="transfer" size={14} /> {t('station.transfer')}
            </>
          ) : undefined
        }
        action={
          <button
            className={`mil-dhead__act mil-dhead__act--fav${fav ? ' is-on' : ''}`}
            onClick={() => toggleFav(stationId)}
            aria-label={t('nav.favorite')}
            aria-pressed={fav}
          >
            <Icon name={fav ? 'star-filled' : 'star'} />
          </button>
        }
      />

      {/* The lines that serve this stop (identity) */}
      <div className="mil-stationlines">
        {st.lines
          .filter((id) => !allowed || allowed.has(id))
          .map((id) => {
            const l = getLine(id)
            return l ? (
              <button key={id} onClick={() => openLine(id)} aria-label={l.name.tr}>
                <LineBadge line={l} />
              </button>
            ) : null
          })}
      </div>

      {/* Live first: a train at the platform now, then approaching services by category */}
      {atPlatform.length > 0 && (
        <Section title={t('station.atPlatform')} live>
          <ul className="mil-arrivals">
            {atPlatform.map((a, i) => {
              const l = getLine(a.lineId)
              const toward = getStation(a.towardId)
              return (
                <li key={`p-${a.lineId}-${a.direction}-${i}`} className="mil-arr mil-arr--platform">
                  {l && <LineBadge line={l} size="sm" />}
                  <span className="mil-arr__toward">{toward?.name.tr}</span>
                  <span className="mil-arr__platform">
                    <span className="mil-arr__platform-dot" />
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
          <p className="mil-empty">{t('station.noService')}</p>
        </Section>
      ) : (
        // one section per transport category: "Yaklaşan Metro", "Yaklaşan Metrobüs", …
        MODE_ORDER.map((mode) => {
          const rows = arrivals.filter((a) => getLine(a.lineId)?.mode === mode)
          if (!rows.length) return null
          return (
            <Section key={mode} title={t('station.approachingMode', { mode: t(`mode.${mode}`) })} live>
              <ul className="mil-arrivals">
                {rows.slice(0, 6).map((a, i) => {
                  const l = getLine(a.lineId)
                  const toward = getStation(a.towardId)
                  return (
                    <li key={`${a.lineId}-${a.direction}-${i}`} className="mil-arr">
                      {l && <LineBadge line={l} size="sm" />}
                      <span className="mil-arr__toward">{toward?.name.tr}</span>
                      <span className="mil-arr__eta">
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

      {/* Plan a route touching this stop */}
      <div className="mil-rowactions">
        <button
          className="mil-btn mil-btn--ghost"
          onClick={() => openJourney({ kind: 'station', id: stationId, label: st.name.tr }, null)}
        >
          <Icon name="train" size={16} />
          {t('journey.fromHere')}
        </button>
        <button
          className="mil-btn mil-btn--ghost"
          onClick={() => openJourney(null, { kind: 'station', id: stationId, label: st.name.tr })}
        >
          <Icon name="pin" size={16} />
          {t('journey.toHere')}
        </button>
      </div>

      {hasFacilities && (
        <Section title={t('station.facilities')}>
          <div className="mil-facils">
            {acc.elevator && (
              <span className="mil-facil">
                <Icon name="elevator" size={15} />
                {`${t('facility.elevator')}${x.liftCount ? ` · ${x.liftCount}` : ''}`}
              </span>
            )}
            {acc.escalator && (
              <span className="mil-facil">
                <Icon name="escalator" size={15} />
                {`${t('facility.escalator')}${x.escalatorCount ? ` · ${x.escalatorCount}` : ''}`}
              </span>
            )}
            {acc.stepFree && (
              <span className="mil-facil">
                <Icon name="accessible" size={15} />
                {t('facility.accessible')}
              </span>
            )}
            {st.facilities?.includes('wc') && (
              <span className="mil-facil">
                <Icon name="wc" size={15} />
                {t('facility.wc')}
              </span>
            )}
            {x.babyRoom && (
              <span className="mil-facil">
                <Icon name="baby" size={15} />
                {t('facility.baby')}
              </span>
            )}
            {x.masjid && (
              <span className="mil-facil">
                <Icon name="mosque" size={15} />
                {t('facility.masjid')}
              </span>
            )}
          </div>
        </Section>
      )}
    </div>
  )
}
