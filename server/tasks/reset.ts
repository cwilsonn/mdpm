export default defineTask({
  meta: {
    name: 'reset',
    description: 'Wipe all projects, then re-seed demo content',
  },
  run() {
    if (!isDemo()) {
      return { result: 'skipped: only runs in demo mode (MDPM_DEMO=1)' }
    }
    resetContent()
    return { result: 'ok' }
  },
})
