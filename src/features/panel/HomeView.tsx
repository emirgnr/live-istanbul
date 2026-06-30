import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon } from '@/components/Icon'
import { Section, LineRow, StationRow } from './ui'
import { useAppStore } from '@/lib/stores/useAppStore'
import { allLines, allStations } from '@/data'
import { nearestStation } from '@/lib/stats'
import type { LineMode } from '@/lib/network/types'

// transport modes in the official display order — same category grouping as the schedule view
const MODE_ORDER: LineMode[] = ['metro', 'marmaray', 'suburban', 'tram', 'funicular', 'cablecar', 'brt']

export function HomeView() {
  const { t } = useTranslation()
  const query = useAppStore((s) => s.query)
  const openStation = useAppStore((s) => s.openStation)
  const openJourney = useAppStore((s) => s.openJourney)
  const openSchedule = useAppStore((s) => s.openSchedule)
  const favLines = useAppStore((s) => s.favorites.lines)
  const favStations = useAppStore((s) => s.favorites.stations)
  const [locating, setLocating] = useState(false)

  function locate() {
    if (!navigator.geolocation || locating) return
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        const n = nearestStation(pos.coords.longitude, pos.coords.latitude)
        if (n) openStation(n.station.id)
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 8000 },
    )
  }

  const lines = allLines()
  const q = query.trim().toLocaleLowerCase('tr')

  const results = useMemo(() => {
    if (!q) return null
    const ls = lines.filter(
      (l) =>
        l.code.toLocaleLowerCase('tr').includes(q) || l.name.tr.toLocaleLowerCase('tr').includes(q),
    )
    const ss = allStations()
      .filter((s) => s.name.tr.toLocaleLowerCase('tr').includes(q))
      .sort((a, b) => a.name.tr.localeCompare(b.name.tr, 'tr'))
      .slice(0, 25)
    return { ls, ss }
  }, [q, lines])

  if (results) {
    return (
      <div className="mil-view">
        {results.ls.length > 0 && (
          <Section title={t('home.lines')}>
            {results.ls.map((l) => (
              <LineRow key={l.id} lineId={l.id} />
            ))}
          </Section>
        )}
        {results.ss.length > 0 && (
          <Section title={t('home.stations')}>
            {results.ss.map((s) => (
              <StationRow key={s.id} stationId={s.id} />
            ))}
          </Section>
        )}
        {results.ls.length === 0 && results.ss.length === 0 && (
          <p className="mil-empty">{t('home.noResults')}</p>
        )}
      </div>
    )
  }

  return (
    <div className="mil-view">
      {/* Hub: a prominent route-planning call to action + two quick shortcuts. */}
      <div className="mil-hub">
        <button className="mil-hub__cta" onClick={() => openJourney()}>
          <span className="mil-hub__cta-icon">
            <Icon name="transfer" size={20} />
          </span>
          <span className="mil-hub__cta-text">{t('journey.plan')}</span>
          <Icon name="chevron-right" size={20} className="mil-hub__cta-chev" />
        </button>
        <div className="mil-hub__grid">
          <button className="mil-hub__tile" onClick={locate} disabled={locating}>
            <Icon name="pin" size={20} className="mil-hub__tile-icon" />
            <span>{locating ? `${t('home.locating')}…` : t('home.nearby')}</span>
          </button>
          <button className="mil-hub__tile" onClick={openSchedule}>
            <Icon name="calendar" size={20} className="mil-hub__tile-icon" />
            <span>{t('schedule.title')}</span>
          </button>
        </div>
      </div>

      {favLines.length + favStations.length > 0 && (
        <Section title={t('home.favorites')}>
          {favLines.map((id) => (
            <LineRow key={id} lineId={id} />
          ))}
          {favStations.map((id) => (
            <StationRow key={id} stationId={id} />
          ))}
        </Section>
      )}

      {MODE_ORDER.map((mode) => {
        const items = lines.filter((l) => l.mode === mode)
        if (!items.length) return null
        return (
          <Section key={mode} title={t(`mode.${mode}`)}>
            {items.map((l) => (
              <LineRow key={l.id} lineId={l.id} />
            ))}
          </Section>
        )
      })}
    </div>
  )
}
