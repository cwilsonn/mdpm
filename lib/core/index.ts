import { createApi } from './api'
import { resolveConfig, type CoreConfig } from './config'
import { createOps } from './ops'
import { createReader } from './read'

export function createCore(config: CoreConfig = resolveConfig()) {
  const reader = createReader(config)
  const api = createApi(config)
  return createOps(config, reader, api)
}

export type { CoreConfig } from './config'
export type { Ops } from './ops'
