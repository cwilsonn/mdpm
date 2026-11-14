import pkg from '../../package.json' with { type: 'json' }

// release-please keeps package.json current.
export const VERSION: string = pkg.version
