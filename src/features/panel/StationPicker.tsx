import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon } from '@/components/Icon'
import { LineBadge } from '@/features/lines/LineBadge'
import { allStations, getLine } from '@/data'
import { searchPlaces, type PlaceResult } from '@/lib/geocode'
import type { JourneyPoint } from '@/lib/journey/plan'

/**
 * Endpoint picker for the journey planner. Matches network stations instantly and,
 * for free-text addresses / place names ("X Okulu", a street, …), geocodes via
 * Photon. Also offers "my location" (GPS). Selection yields a {@link JourneyPoint}.
 */
export function StationPicker({
  value,
  onChange,
  placeholder,
}: {
  value: JourneyPoint | null
  onChange: (p: JourneyPoint) => void
  placeholder: string
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [q, setQ] = useState('')
  const [places, setPlaces] = useState<PlaceResult[]>([])
  const [loadingPlaces, setLoadingPlaces] = useState(false)
  const [locating, setLocating] = useState(false)

  const stations = useMemo(() => {
    const s = q.trim().toLocaleLowerCase('tr')
    if (!s) return []
    return allStations()
      .filter((st) => st.name.tr.toLocaleLowerCase('tr').includes(s))
      .sort((a, b) => a.name.tr.localeCompare(b.name.tr, 'tr'))
      .slice(0, 6)
  }, [q])

  // debounced geocoding of the free-text query
  useEffect(() => {
    const s = q.trim()
    if (s.length < 3) {
      setPlaces([])
      setLoadingPlaces(false)
      return
    }
    setLoadingPlaces(true)
    const ctrl = new AbortController()
    const timer = setTimeout(async () => {
      const r = await searchPlaces(s, ctrl.signal)
      setPlaces(r)
      setLoadingPlaces(false)
    }, 350)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [q])

  const close = () => {
    setEditing(false)
    setQ('')
    setPlaces([])
  }
  const useMyLocation = () => {
    if (!navigator.geolocation || locating) return
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        onChange({ kind: 'place', coord: [pos.coords.longitude, pos.coords.latitude], label: t('journey.myLocation') })
        close()
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 8000 },
    )
  }

  if (!editing) {
    return (
      <button className="picker__chip" onClick={() => setEditing(true)}>
        <Icon name="pin" size={16} />
        {value ? (
          <span className="picker__name">{value.label}</span>
        ) : (
          <span className="picker__ph">{placeholder}</span>
        )}
      </button>
    )
  }

  const hasResults = stations.length > 0 || places.length > 0
  return (
    <div className="picker">
      <div className="picker__input-row">
        <Icon name="search" size={16} />
        <input
          autoFocus
          className="picker__input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          onBlur={() => setTimeout(close, 180)}
        />
        <button
          className="picker__close"
          onMouseDown={(e) => e.preventDefault()}
          onClick={close}
          aria-label={t('nav.close')}
        >
          <Icon name="x" size={15} />
        </button>
      </div>
      <ul className="picker__results">
        <li>
          <button
            className="picker__result picker__result--loc"
            onMouseDown={(e) => e.preventDefault()}
            onClick={useMyLocation}
            disabled={locating}
          >
            <span className="picker__result-name">
              <Icon name="crosshair" size={15} /> {locating ? `${t('home.locating')}…` : t('journey.myLocation')}
            </span>
          </button>
        </li>
        {stations.map((st) => (
          <li key={`s-${st.id}`}>
            <button
              className="picker__result"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange({ kind: 'station', id: st.id, label: st.name.tr })
                close()
              }}
            >
              <span className="picker__result-name">{st.name.tr}</span>
              <span className="picker__result-badges">
                {st.lines.map((id) => {
                  const l = getLine(id)
                  return l ? <LineBadge key={id} line={l} size="sm" /> : null
                })}
              </span>
            </button>
          </li>
        ))}
        {places.map((p, i) => (
          <li key={`p-${i}`}>
            <button
              className="picker__result"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange({ kind: 'place', coord: p.coord, label: p.label })
                close()
              }}
            >
              <span className="picker__result-place">
                <span className="picker__result-name">{p.label}</span>
                {p.secondary && <span className="picker__result-sub">{p.secondary}</span>}
              </span>
              <Icon name="pin" size={14} className="picker__result-pin" />
            </button>
          </li>
        ))}
        {loadingPlaces && <li className="picker__loading">{t('journey.searching')}</li>}
        {!hasResults && !loadingPlaces && q.trim().length > 0 && (
          <li className="picker__loading">{t('home.noResults')}</li>
        )}
      </ul>
    </div>
  )
}
