import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages project sites live at /<repo-name>/. The deploy workflow sets
// PAGES_BASE. Local dev stays at the site root.
const base = process.env.PAGES_BASE || '/';

export default defineConfig({
  base,
  plugins: [
    VitePWA({
      // prompt mode so we can hold a reload while a New job form has data.
      // skipWaiting and clientsClaim still activate the new worker immediately.
      registerType: 'prompt',
      injectRegister: null,
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
        cacheId: 'heartland-crew-v10',
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // index.html and version.json are fetched network-first below so a
        // phone sees a new build without a full restart.
        globIgnores: ['**/index.html', '**/version.json'],
        navigateFallback: null,
        globPatterns: ['**/*.{js,css,html,png,svg,webp,ico,webmanifest,txt}'],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'app-pages',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
          {
            urlPattern: /\/version\.json$/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'app-version',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 1, maxAgeSeconds: 60 * 60 },
            },
          },
        ],
        // No runtime route for map tiles. The service worker must not intercept
        // them: OpenStreetMap rejects fetches that arrive without a Referer,
        // and a worker fetch was dropping that header. The browser sends
        // Referer: origin on its own. Supabase stays uncached too.
      },
    }),
  ],
});
