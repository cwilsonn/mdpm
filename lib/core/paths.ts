import { realpathSync } from 'node:fs'

// Compare real paths so /tmp vs /private/tmp (macOS) or a symlinked checkout don't look like a mismatch.
export function samePath(a: string, b: string) {
  const real = (p: string) => { try { return realpathSync(p) } catch { return p } }
  return real(a) === real(b)
}
