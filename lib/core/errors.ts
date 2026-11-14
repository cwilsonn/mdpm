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

export class ContentRootMismatchError extends Error {
  override name = 'ContentRootMismatchError'
}

// Write errors. The server maps them to 400 / 429 / 409; the CLI and MCP print the message.

export class ValidationError extends Error {
  override name = 'ValidationError'
}

export class LimitError extends Error {
  override name = 'LimitError'
}

export class WriteBusyError extends Error {
  override name = 'WriteBusyError'
}
