import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages project sites live at /<repo-name>/. The deploy workflow sets
// PAGES_BASE. Local dev stays at the site root.
const base = process.env.PAGES_BASE || '/';

export default defineConfig({
  base,
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'icons/apple-touch-icon.png', 'robots.txt'],
      manifest: {
        id: base,
        name: 'Heartland ProGutters Crew',
        short_name: 'HL Crew',
        description: 'Post finished Heartland ProGutters jobs for approval.',
        theme_color: '#14352a',
        background_color: '#f4f0e6',
        display: 'standalone',
        start_url: base,
        scope: base,
        lang: 'en',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Bump this when home-screen icons or cached app files must replace
        // an older copy already saved on a phone.
        cacheId: 'heartland-crew-v6',
        cleanupOutdatedCaches: true,
        navigateFallback: 'index.html',
        globPatterns: ['**/*.{js,css,html,png,svg,webp,ico,webmanifest,txt}'],
        // Supabase is a different origin and must not be cached: responses can
        // contain private job locations for signed-in approvers.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/tile\.openstreetmap\.org\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'osm-tiles',
              expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 14 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});
