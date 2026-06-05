import { zipSync } from 'fflate'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

function collectFiles(dir: string): Record<string, Uint8Array> {
  const result: Record<string, Uint8Array> = {}

  function walk(current: string) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      }
      else {
        const rel = relative(dir, full).replace(/\\/g, '/')
        result[`content/${rel}`] = readFileSync(full)
      }
    }
  }

  walk(dir)
  return result
}

export default defineEventHandler((event) => {
  const date = new Date().toISOString().split('T')[0]
  const filename = `mdpm-content-${date}.zip`

  const files = collectFiles(contentRoot())
  const zipped = zipSync(files, { level: 6 })

  event.node.res.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length': zipped.byteLength,
  })
  event.node.res.end(Buffer.from(zipped.buffer, zipped.byteOffset, zipped.byteLength))
})
