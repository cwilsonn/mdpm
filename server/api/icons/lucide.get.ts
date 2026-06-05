import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

export default defineEventHandler(() => {
  const iconsJson = require('@iconify-json/lucide/icons.json') as { icons: Record<string, unknown> }
  return Object.keys(iconsJson.icons)
})
