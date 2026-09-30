import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ConfigError } from './errors'

export const DEFAULT_BASE_URL = 'http://mdpm.local:3333'

// lib/core/config.ts -> repo root. Node resolves symlinks for the entry module,
// so this is the real checkout even when invoked through a linked bin.
export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))

export interface CoreConfig {
  contentPath: string
  baseUrl: string
}

// Where each value came from, highest priority first: flag > env > file > default.
export type ConfigSource = 'flag' | 'env' | 'file' | 'default'

export interface ConfigOptions {
  flags?: Partial<CoreConfig>
  env?: NodeJS.ProcessEnv
}

export interface LoadedConfig {
  config: CoreConfig
  sources: Record<keyof CoreConfig, ConfigSource>
  configFile: string
  configFileFound: boolean
}

const KEYS = ['contentPath', 'baseUrl'] as const

export function configFilePath(env: NodeJS.ProcessEnv = process.env) {
  return env.MDPM_CONFIG ?? join(env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'mdpm', 'config.json')
}

function expandHome(p: string) {
  return p === '~' || p.startsWith('~/') ? join(homedir(), p.slice(1)) : p
}

function readConfigFile(path: string): Partial<CoreConfig> {
  if (!existsSync(path)) return {}
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  }
  catch (err) {
    throw new ConfigError(`invalid JSON in ${path}: ${(err as Error).message}`)
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ConfigError(`${path} must contain a JSON object`)
  const file: Partial<CoreConfig> = {}
  for (const key of KEYS) {
    const value = (raw as Record<string, unknown>)[key]
    if (value === undefined) continue
    if (typeof value !== 'string' || !value) throw new ConfigError(`${path}: "${key}" must be a non-empty string`)
    // Relative paths in the file are relative to the file, not to wherever the CLI runs.
    file[key] = key === 'contentPath' ? resolve(dirname(path), expandHome(value)) : value
  }
  return file
}

function normalize(key: keyof CoreConfig, value: string, origin: string) {
  if (key === 'contentPath') return resolve(expandHome(value))
  try {
    return new URL(value).toString().replace(/\/$/, '')
  }
  catch {
    throw new ConfigError(`${origin}: invalid base URL "${value}"`)
  }
}

// Precedence: flags > env (MDPM_CONTENT_PATH, MDPM_BASE_URL) > config file > defaults derived
// from this checkout. Zero setup works: the default content dir is the repo's own.
export function loadConfig({ flags = {}, env = process.env }: ConfigOptions = {}): LoadedConfig {
  const configFile = configFilePath(env)
  const file = readConfigFile(configFile)
  const envValues: Partial<CoreConfig> = { contentPath: env.MDPM_CONTENT_PATH, baseUrl: env.MDPM_BASE_URL }
  const defaults: CoreConfig = { contentPath: join(REPO_ROOT, 'content'), baseUrl: DEFAULT_BASE_URL }

  const layers: [ConfigSource, string, Partial<CoreConfig>][] = [
    ['flag', 'flag', flags],
    ['env', 'environment', envValues],
    ['file', configFile, file],
  ]
  const config = {} as CoreConfig
  const sources = {} as Record<keyof CoreConfig, ConfigSource>
  for (const key of KEYS) {
    const hit = layers.find(([, , values]) => values[key])
    config[key] = hit ? normalize(key, hit[2][key]!, hit[1]) : defaults[key]
    sources[key] = hit ? hit[0] : 'default'
  }
  return { config, sources, configFile, configFileFound: existsSync(configFile) }
}

export function resolveConfig(opts: ConfigOptions = {}): CoreConfig {
  return loadConfig(opts).config
}

export function contentPathOf(config: CoreConfig, ...parts: string[]) {
  return join(config.contentPath, ...parts)
}
