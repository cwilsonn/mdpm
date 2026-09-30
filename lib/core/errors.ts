// Typed errors so adapters (CLI exit codes, MCP messages) don't match on message text.

export class NotFoundError extends Error {
  override name = 'NotFoundError'
}

export class ServerUnreachableError extends Error {
  override name = 'ServerUnreachableError'
}

export class ConfigError extends Error {
  override name = 'ConfigError'
}

export class AmbiguousError extends Error {
  override name = 'AmbiguousError'
}
