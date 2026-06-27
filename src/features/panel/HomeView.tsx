import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon } from '@/components/Icon'
import { Section, LineRow, StationRow } from './ui'
import { useAppStore } from '@/lib/stores/useAppStore'
import { allLines, allStations } from '@/data'

export function HomeView() {
  const { t } = useTranslation()
  const query = useAppStore((s) => s.query)
  const setQuery = useAppStore((s) => s.setQuery)
  const setExpanded = useAppStore((s) => s.setSheetExpanded)
  const favLines = useAppStore((s) => s.favorites.lines)
  const favStations = useAppStore((s) => s.favorites.stations)
  const recents = useAppStore((s) => s.recentStations)

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

  return (
    <div className="view">
      <div className="search">
        <Icon name="search" size={18} />
        <input
          className="search__input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setExpanded(true)}
          placeholder={t('home.search')}
          aria-label={t('home.search')}
        />
        {query && (
          <button className="search__clear" onClick={() => setQuery('')} aria-label={t('nav.clear')}>
            <Icon name="x" size={16} />
          </button>
        )}
      </div>

      {results ? (
        <>
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
            <p className="empty">{t('home.noResults')}</p>
          )}
        </>
      ) : (
        <>
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
          {recents.length > 0 && (
            <Section title={t('home.recent')}>
              {recents.slice(0, 5).map((id) => (
                <StationRow key={id} stationId={id} />
              ))}
            </Section>
          )}
          <Section title={t('home.lines')}>
            {lines.map((l) => (
              <LineRow key={l.id} lineId={l.id} />
            ))}
          </Section>
        </>
      )}
    </div>
  )
}
