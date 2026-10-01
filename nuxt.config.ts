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
    ...(process.env.NODE_ENV === 'production' && {
      scheduledTasks: {
        '0 * * * *': ['reset'],
      },
    }),
  },
  vite: {
    server: {
      hmr: {
        // `mdpm start` sets MDPM_HOST from the base URL's hostname, so a machine without /etc/hosts access
    // can use `http://localhost:3333`. Plain `pnpm dev` keeps the default.
    host: process.env.MDPM_HOST || 'mdpm.local',
      },
    },
    optimizeDeps: {
      include: [],
    },
  }
})
