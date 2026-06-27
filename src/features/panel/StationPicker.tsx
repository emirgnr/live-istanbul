import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon } from '@/components/Icon'
import { LineBadge } from '@/features/lines/LineBadge'
import { allStations, getLine, getStation } from '@/data'
import type { StationId } from '@/lib/network/types'

export function StationPicker({
  value,
  onChange,
  placeholder,
}: {
  value: StationId | null
  onChange: (id: StationId) => void
  placeholder: string
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [q, setQ] = useState('')
  const sel = value ? getStation(value) : null

  const results = useMemo(() => {
    const s = q.trim().toLocaleLowerCase('tr')
    if (!s) return []
    return allStations()
      .filter((st) => st.name.tr.toLocaleLowerCase('tr').includes(s))
      .sort((a, b) => a.name.tr.localeCompare(b.name.tr, 'tr'))
      .slice(0, 8)
  }, [q])

  if (!editing) {
    return (
      <button className="picker__chip" onClick={() => setEditing(true)}>
        <Icon name="pin" size={16} />
        {sel ? (
          <span className="picker__name">{sel.name.tr}</span>
        ) : (
          <span className="picker__ph">{placeholder}</span>
        )}
      </button>
    )
  }

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
          onBlur={() => setTimeout(() => setEditing(false), 150)}
        />
        <button className="picker__close" onClick={() => setEditing(false)} aria-label={t('nav.close')}>
          <Icon name="x" size={15} />
        </button>
      </div>
      {results.length > 0 && (
        <ul className="picker__results">
          {results.map((st) => (
            <li key={st.id}>
              <button
                className="picker__result"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(st.id)
                  setQ('')
                  setEditing(false)
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
        </ul>
      )}
    </div>
  )
}
