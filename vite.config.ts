import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'

// https://vite.dev/config/
// Deployed to GitHub Pages at https://emirgnr.github.io/live-istanbul/, so the
// production build is served from the "/live-istanbul/" sub-path. Dev/preview
// stay at root for convenience.
export default defineConfig(({ command }) => {
  const base = command === 'build' ? '/live-istanbul/' : '/'
  return {
    base,
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
        // icon paths are relative so they resolve against the manifest URL
        // (which lives under `base`) — works on any sub-path.
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
          start_url: base,
          scope: base,
          categories: ['travel', 'navigation', 'maps'],
          icons: [
            { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2,json}'],
          // Map tiles are large & frequently updated — cache at runtime, not precache.
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/[a-z0-9-]*\.?basemaps\.cartocdn\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'basemap-tiles',
                expiration: { maxEntries: 2000, maxAgeSeconds: 60 * 60 * 24 * 14 },
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
    build: {
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('maplibre-gl')) return 'maplibre'
          },
        },
      },
    },
  }
})
