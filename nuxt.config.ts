export default defineNuxtConfig({
  extends: [
    './modules/_core',
    './modules/inbox',
    './modules/project',
    './modules/task',
    './modules/doc',
  ],
  modules: ['@nuxt/ui', '@nuxt/content'],
  css: ['~/assets/css/main.css'],
  compatibilityDate: '2025-01-15',
  devtools: { enabled: true },
  devServer: {
    port: 3333,
    // `mdpm start` sets MDPM_HOST from the base URL's hostname, so a machine without /etc/hosts access
    // can use `http://localhost:3333`. Plain `pnpm dev` keeps the default.
    host: process.env.MDPM_HOST || 'mdpm.local',
  },
  future: { compatibilityVersion: 4 },
  app: {
    head: {
      titleTemplate: '%s | .mdpm',
      link: [
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
        { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32x32.png' },
        { rel: 'icon', type: 'image/png', sizes: '16x16', href: '/favicon-16x16.png' },
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
      ],
    },
  },
  nitro: {
    experimental: {
      tasks: true,
    },
    // Always registered: whether the hourly reset does anything is decided at runtime by MDPM_DEMO
    // (server/utils/demo.ts). A build-time condition here is what baked the reset into local builds.
    scheduledTasks: {
      '0 * * * *': ['reset'],
    },
  },
  vite: {
    server: {
      // The HMR websocket binds the same host as the dev server (see devServer.host above).
      ws: {
        host: process.env.MDPM_HOST || 'mdpm.local',
      },
    },
    optimizeDeps: {
      include: [
        // Discovered late otherwise, which makes Vite reload the page on first visit.
        'vue-draggable-plus',
        // <MDC> parses markdown in the browser after client-side navigation. @nuxtjs/mdc asks Vite to
        // pre-bundle its parser deps as `@nuxtjs/mdc > …`, but pnpm doesn't hoist @nuxtjs/mdc (it comes
        // in through @nuxt/content), so those entries don't resolve and are dropped. CJS-only deps
        // (`extend` via unified, `debug` via remark-parse > micromark) are then served raw, the import
        // fails, and the task body renders empty. This is mdc's list plus the rest of its parser's imports.
        ...[
          'unified', 'remark-parse', 'remark-gfm', 'remark-emoji', 'remark-mdc', 'remark-rehype',
          'rehype-raw', 'rehype-external-links', 'rehype-sort-attribute-values', 'rehype-sort-attributes',
          'mdast-util-to-hast', 'hast-util-to-string', 'micromark-util-sanitize-uri', 'unist-util-visit',
          'parse5', 'vfile', 'detab', 'github-slugger',
        ].map(pkg => `@nuxt/content > @nuxtjs/mdc > ${pkg}`),
      ],
    },
  }
})
