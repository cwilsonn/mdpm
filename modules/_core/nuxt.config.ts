export default defineNuxtConfig({
  // Auto-import shared type exports (FilterItem, ...) app-wide, like modules/task/types.
  imports: {
    dirs: ['types'],
  },
})
