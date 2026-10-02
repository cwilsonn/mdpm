import pkg from '../../package.json' with { type: 'json' }

// release-please keeps package.json current, so deprecation notices never name a stale version.
export const VERSION: string = pkg.version

// Removal is announced two minor releases out ("0.9.0" -> "0.11"), the compatibility window in the
// links design doc.
export function removalVersion(version = VERSION) {
  const [major, minor] = version.split('.').map(Number)
  return `${major}.${(minor ?? 0) + 2}`
}
