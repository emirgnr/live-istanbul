import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { familyLineIds, getStation } from '@/data'
import { nextArrivals } from '@/lib/simulation/engine'
import { toMinutes } from '@/lib/format'
import { lineById, nodeById, type SchemeLine, type SchemeNode } from './schemeModel'
import { resolveOur } from './schemeBridge'
import './scheme-card.css'

// labels for lines the scheme draws without a code chip (e.g. the grey commuter line)
const COLOR_LABEL: Record<string, string> = { '#585b60': 'Marmaray', '#eede9e': 'TF', '#95aeab': 'T2' }
const lineLabel = (l?: SchemeLine) =>
  (l?.codes.length ? l.codes.join(' / ') : l ? COLOR_LABEL[l.color] ?? '•' : '•')

function LineChip({ lineId, onClick }: { lineId: string; onClick?: () => void }) {
  const l = lineById[lineId]
  if (!l) return null
  return (
    <button
      type="button"
      className="schip"
      style={{ background: l.color }}
      onClick={onClick}
      disabled={!onClick}
    >
      {lineLabel(l)}
    </button>
  )
}

interface StationProps {
  nodeId: string
  clockMs: number
  onClose: () => void
  onSelectNode: (id: string) => void
  onSelectLine: (id: string) => void
}

/** Per-line station card: the tapped dot's own line, its neighbours, interchanges and (where we
 *  simulate that line) live arrivals — all scoped to THIS node's line only. */
export function SchemeStationCard({ nodeId, clockMs, onClose, onSelectNode, onSelectLine }: StationProps) {
  const { t } = useTranslation()
  const node: SchemeNode | undefined = nodeById[nodeId]

  const arrivals = useMemo(() => {
    if (!node) return []
    const ref = resolveOur(node)
    if (!ref) return []
    const fam = new Set(familyLineIds(ref.lineId))
    const seen = new Set<string>()
    return nextArrivals(clockMs, ref.stationId)
      .filter((a) => {
        if (!fam.has(a.lineId) || seen.has(a.towardId)) return false
        seen.add(a.towardId)
        return true
      })
      .slice(0, 6)
  }, [node, clockMs])

  if (!node) return null
  const line = lineById[node.lineId]
  // de-dupe interchange targets by their line (one chip per connecting line)
  const transfers = node.transfers
    .map((id) => nodeById[id])
    .filter(Boolean)
    .filter((n, i, arr) => arr.findIndex((m) => m.lineId === n.lineId) === i)

  return (
    <div className="scard" role="dialog">
      <button className="scard__close" onClick={onClose} aria-label={t('nav.close')}>
        ×
      </button>
      <div className="scard__head">
        <LineChip lineId={node.lineId} onClick={() => onSelectLine(node.lineId)} />
        <div>
          <h2>{node.name}</h2>
          {line && <p className="scard__line-name">{line.name}</p>}
        </div>
      </div>

      {transfers.length > 0 && (
        <section className="scard__sec">
          <h3>{t('station.transfer')}</h3>
          <div className="scard__transfers">
            {transfers.map((n) => (
              <button key={n.id} className="scard__xfer" onClick={() => onSelectNode(n.id)}>
                <LineChip lineId={n.lineId} />
                <span>{n.name}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {arrivals.length > 0 && (
        <section className="scard__sec">
          <h3>{t('station.approaching')}</h3>
          <ul className="scard__arr">
            {arrivals.map((a, i) => (
              <li key={`${a.lineId}-${a.direction}-${i}`}>
                <span className="scard__toward">{getStation(a.towardId)?.name.tr ?? ''}</span>
                <span className="scard__eta">
                  {a.etaSec < 45 ? t('eta.now') : `${toMinutes(a.etaSec)} ${t('units.min')}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {node.neighbors.length > 0 && (
        <section className="scard__sec">
          <h3>{t('train.upcoming')}</h3>
          <div className="scard__neighbors">
            {node.neighbors.map((id) => (
              <button key={id} className="scard__nb" onClick={() => onSelectNode(id)}>
                {nodeById[id]?.name}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

interface LineProps {
  lineId: string
  onClose: () => void
  onSelectNode: (id: string) => void
}

/** Line card: the line's own identity + its full, ordered station list. */
export function SchemeLineCard({ lineId, onClose, onSelectNode }: LineProps) {
  const { t } = useTranslation()
  const line = lineById[lineId]
  if (!line) return null
  return (
    <div className="scard" role="dialog">
      <button className="scard__close" onClick={onClose} aria-label={t('nav.close')}>
        ×
      </button>
      <div className="scard__head">
        <LineChip lineId={line.id} />
        <div>
          <h2>{line.name}</h2>
          <p className="scard__line-name">{t('line.stations')}: {line.nodeIds.length}</p>
        </div>
      </div>
      <ol className="scard__stops">
        {line.nodeIds.map((id) => {
          const n = nodeById[id]
          if (!n) return null
          return (
            <li key={id}>
              <button onClick={() => onSelectNode(id)}>
                <span className="scard__stopdot" style={{ borderColor: line.color }} />
                {n.name}
                {n.transfers.length > 0 && <span className="scard__xtag">⇄</span>}
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
