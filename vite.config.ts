import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Metro Live Istanbul',
        short_name: 'Metro Live',
        description:
          'İstanbul metro ve Marmaray trenlerinin canlı konumu — Live positions of Istanbul metro & Marmaray',
        lang: 'tr',
        theme_color: '#0b2545',
        background_color: '#0b2545',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        categories: ['travel', 'navigation', 'maps'],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,json}'],
        // Map tiles are large & frequently updated — cache at runtime, not precache.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/tiles\.openfreemap\.org\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'basemap-tiles',
              expiration: { maxEntries: 1000, maxAgeSeconds: 60 * 60 * 24 * 14 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  server: {
    host: true,
  },
})
