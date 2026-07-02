/**
 * index.ts — Sunucu giriş noktası. Uygulamayı ayağa kaldırır, mapping'i yükler,
 * bağlamı/mapping'i periyodik tazeler, zarifçe kapanır.
 */

import { config } from './config'
import { log } from './logger'
import * as mappingStore from './mappingStore'
import * as seferService from './seferService'
import { createApp, apiLimiter } from './app'

export function start() {
  mappingStore.init() // seed yükle + pageObserver bağla
  const app = createApp()

  const server = app.listen(config.port, () => {
    log.info(`Metro Proxy dinlemede: http://localhost:${config.port}`)
    log.info(`Örnek: http://localhost:${config.port}/api/stations/board?line=M3&station=Özgürlük Meydanı`)
  })

  seferService.warmup() // arka planda bağlamı/canlı mapping'i ısıt

  const refreshTimer = setInterval(() => void seferService.warmup(), config.sessionTtlMs)
  const sweepTimer = setInterval(() => apiLimiter.sweep(), config.apiRateWindowMs)
  refreshTimer.unref?.()
  sweepTimer.unref?.()

  const shutdown = (sig: string) => {
    log.info(`${sig} alındı, kapanıyor…`)
    clearInterval(refreshTimer)
    clearInterval(sweepTimer)
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 5000).unref?.()
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  return server
}

// tsx ile doğrudan çalıştırıldığında başlat.
start()
