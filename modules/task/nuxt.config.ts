export default defineNuxtConfig({
  // Auto-import the module's type exports (Task, StatusCfg, ...) app-wide,
  // matching how utils/composables are already auto-imported across layers.
  imports: {
    dirs: ['types'],
  },
})
