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
        cacheId: 'heartland-crew-v9',
        cleanupOutdatedCaches: true,
        navigateFallback: 'index.html',
        // Do not answer tile requests or real files with index.html.
        navigateFallbackDenylist: [/^\/_/, /\/[^/?]+\.[^/]+$/, /tile\.openstreetmap\.org/],
        globPatterns: ['**/*.{js,css,html,png,svg,webp,ico,webmanifest,txt}'],
        // No runtime route for map tiles. The service worker must not intercept
        // them: OpenStreetMap rejects fetches that arrive without a Referer,
        // and a worker fetch was dropping that header. The browser sends
        // Referer: origin on its own. Supabase stays uncached too.
      },
    }),
  ],
});
