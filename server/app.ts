/**
 * app.ts — Express Proxy / BFF uygulaması (rotalar + rate-limit + hata yönetimi).
 * İstemci ASLA doğrudan metro.istanbul'a gitmez; sadece buraya gelir.
 *
 * Rotalar:
 *   GET /health
 *   GET /api/lines                         -> tüm hatlar (kod, ad, renk, duraklar, yönler)
 *   GET /api/lines/:code                   -> tek hat
 *   GET /api/departures?station=&route=    -> tek yön canlı seferler
 *   GET /api/stations/board?line=&station= -> durağın TÜM yönleri (Yaklaşan Seferler ekranı)
 */

import express, { type Request, type Response, type NextFunction } from 'express'
import cors from 'cors'

import { config } from './config'
import { log } from './logger'
import * as mappingStore from './mappingStore'
import * as seferService from './seferService'
import { SlidingWindowLimiter } from './rateLimiter'

export const apiLimiter = new SlidingWindowLimiter({
  windowMs: config.apiRateWindowMs,
  max: config.apiRateMax,
})

interface HttpErrorLike extends Error {
  status?: number
}

export function createApp() {
  const app = express()
  // Güvenlik: varsayılan KAPALI. Açıkça yapılandırılmadıkça X-Forwarded-For güvenilmez,
  // böylece req.ip taklit edilip IP başına rate-limit baypas edilemez.
  app.set('trust proxy', config.trustProxy)
  app.use(cors({ origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',') }))
  app.use(express.json())

  // IP başına oran sınırlama
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    const { allowed, remaining, retryAfterMs } = apiLimiter.check(req.ip || 'unknown')
    res.set('X-RateLimit-Remaining', String(remaining))
    if (!allowed) {
      res.set('Retry-After', String(Math.ceil(retryAfterMs / 1000)))
      return res.status(429).json({ hata: 'Çok fazla istek. Lütfen biraz bekleyin.' })
    }
    next()
  })

  app.get('/health', (_req, res) => {
    res.json({ durum: 'ok', mapping: mappingStore.getMeta(), zaman: new Date().toISOString() })
  })

  app.get('/', (_req, res) => {
    res.json({
      servis: 'Metro İstanbul Gerçek Zamanlı Sefer Proxy',
      ornekler: {
        board: '/api/stations/board?line=M3&station=Özgürlük Meydanı',
        departures: '/api/departures?station=251&route=90',
        lines: '/api/lines',
      },
    })
  })

  // Tüm hatlar (UI için)
  app.get('/api/lines', (req, res) => {
    const lite = req.query.full !== '1'
    const lines = mappingStore.getLines().map((l) => ({
      index: l.index,
      kod: l.code,
      ad: l.name,
      renk: l.color,
      yonler: l.routes.map((r) => ({ routeId: r.routeId, etiket: r.label, hedef: r.to })),
      duraklar: lite ? l.stations.map((s) => ({ stationId: s.stationId, ad: s.name })) : l.stations,
    }))
    res.json({ meta: mappingStore.getMeta(), hatlar: lines })
  })

  app.get('/api/lines/:code', (req, res, next) => {
    const line = mappingStore.findLine(req.params.code)
    if (!line) return next(Object.assign(new Error(`Hat bulunamadı: ${req.params.code}`), { status: 404 }))
    res.json(line)
  })

  // Tek yön canlı seferler
  app.get('/api/departures', async (req, res, next) => {
    try {
      const { station, route, line, secim, limit } = req.query as Record<string, string>
      const data = await seferService.getDepartures({ station, route, line, secim, limit: Number(limit) })
      res.set('Cache-Control', `public, max-age=${Math.floor(config.responseCacheTtlMs / 1000)}`)
      res.json(data)
    } catch (err) {
      next(err)
    }
  })

  // Durağın tüm yönleri (Yaklaşan Seferler ekranı bunu kullanır)
  app.get('/api/stations/board', async (req, res, next) => {
    try {
      const { station, line, limit } = req.query as Record<string, string>
      const data = await seferService.getStationBoard({ station, line, limit: Number(limit) })
      res.set('Cache-Control', `public, max-age=${Math.floor(config.responseCacheTtlMs / 1000)}`)
      res.json(data)
    } catch (err) {
      next(err)
    }
  })

  app.use((req, res) => {
    res.status(404).json({ hata: 'Bulunamadı', yol: req.originalUrl })
  })

  app.use((err: HttpErrorLike, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || 500
    if (status >= 500) log.error('İstek hatası:', err.message)
    else log.debug('İstemci hatası:', err.message)
    res.status(status).json({ hata: err.message || 'Sunucu hatası' })
  })

  return app
}
