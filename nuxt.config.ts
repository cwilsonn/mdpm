export default defineNuxtConfig({
  modules: ['@nuxt/ui', '@nuxt/content'],
  css: ['~/assets/css/main.css'],
  compatibilityDate: '2025-01-15',
  devtools: { enabled: true },
  future: { compatibilityVersion: 4 },
  vite: {
    optimizeDeps: {
      include: []
    }
  }
})
