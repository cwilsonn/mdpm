export default defineTask({
  meta: {
    name: 'reset',
    description: 'Wipe all projects and authors, then re-seed demo content',
  },
  run() {
    if (process.env.NODE_ENV !== 'production') {
      return { result: 'skipped: only runs in production' }
    }
    resetContent()
    return { result: 'ok' }
  },
})
