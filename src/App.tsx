import { MapView } from '@/features/map/MapView'

/**
 * App shell. For now: a full-bleed live map with a lightweight branded header.
 * Real navigation, panels and the simulation HUD land after the research milestone.
 */
export default function App() {
  return (
    <>
      <MapView />
      <header className="app-header">
        <div className="app-header__brand">
          <span className="app-header__logo" aria-hidden>
            M
          </span>
          <div className="app-header__title">
            <strong>Metro Live</strong>
            <span>İstanbul</span>
          </div>
        </div>
        <span className="app-header__status">Hazırlanıyor…</span>
      </header>
    </>
  )
}
