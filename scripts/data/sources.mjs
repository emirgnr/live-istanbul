// Authoritative, free, no-key data sources for Istanbul rail.
// See docs/research/RESEARCH-REPORT.md for provenance and verification.

export const METRO_API = 'https://api.ibb.gov.tr/MetroIstanbul/api/MetroMobile/V2'

export const SOURCES = {
  // Metro İstanbul Mobile API V2 — live source of truth for the 18 operated lines:
  // line codes + official RGB colors + first/last times, and every station with
  // Order, lat/lon, and accessibility/facility detail. Verified HTTP 200, no key.
  getLines: {
    url: `${METRO_API}/GetLines`,
    file: 'getlines.json',
  },
  getStations: {
    url: `${METRO_API}/GetStations`,
    file: 'getstations.json',
  },

  // İBB Open Data — official rail LINE geometries (37 MultiLineString features incl.
  // M11 + Marmaray + under-construction), WGS84, no key. Best track-geometry source.
  lineGeometry: {
    url: 'https://data.ibb.gov.tr/dataset/8b8603dd-2642-4789-a891-4bb7cb2c94e8/resource/fe4ec165-9d11-4b83-b031-caea3cfaae55/download/rayli_sistem_hat_verisi.geojson',
    file: 'lines.geojson',
  },

  // İBB Open Data — official rail STATION points (343 features incl. Marmaray +
  // under-construction). Used to source stations for lines absent from the Metro API
  // (M11, Marmaray). Props: ISTASYON, PROJE_ADI, HAT_TURU, PROJE_ASAMA.
  stationPoints: {
    url: 'https://data.ibb.gov.tr/dataset/04ec9805-2483-46c7-914f-30c50857a846/resource/3dc8203f-3613-48a8-85e9-24fffb7821ad/download/rayli_sistem_istasyon_poi_verisi.geojson',
    file: 'stations_poi.geojson',
  },
}
