import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/lib/stores/useAppStore'
import { HomeView } from './HomeView'
import { LineDetailView } from './LineDetailView'
import { StationDetailView } from './StationDetailView'
import './panel.css'

export function Panel() {
  const { t } = useTranslation()
  const view = useAppStore((s) => s.view)
  const expanded = useAppStore((s) => s.sheetExpanded)
  const setExpanded = useAppStore((s) => s.setSheetExpanded)

  return (
    <aside className={`panel${expanded ? ' panel--expanded' : ''}`}>
      <button
        className="panel__handle"
        onClick={() => setExpanded(!expanded)}
        aria-label={t(expanded ? 'panel.collapse' : 'panel.expand')}
      >
        <span className="panel__grip" />
      </button>
      <div className="panel__scroll">
        {view === 'home' && <HomeView />}
        {view === 'line' && <LineDetailView />}
        {view === 'station' && <StationDetailView />}
      </div>
    </aside>
  )
}
