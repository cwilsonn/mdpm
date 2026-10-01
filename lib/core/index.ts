import { createApi, type ApiHooks } from './api'
import { resolveConfig, type CoreConfig } from './config'
import { createOps } from './ops'
import { createReader } from './read'

export function createCore(config: CoreConfig = resolveConfig(), hooks: ApiHooks = {}) {
  const reader = createReader(config)
  const api = createApi(config, hooks)
  return createOps(config, reader, api)
}

export { configFilePath, loadConfig, REPO_ROOT, resolveConfig } from './config'
export type { ConfigSource, LoadedConfig } from './config'
export { excludeLocally, gitToplevel, inferProject, MARKER_FILE, normalizeRepoRef, parseMarker, readMarker } from './project'
export type { InferredProject } from './project'
export { createLifecycle, LifecycleError } from './lifecycle'
export type { Lifecycle, ServerStatus } from './lifecycle'
export type { CoreConfig } from './config'
export { AmbiguousError, ConfigError, ContentRootMismatchError, NotFoundError, ServerUnreachableError } from './errors'
export type { Ops } from './ops'
export { TASK_PRIORITIES, TASK_STATUSES } from './schema'
export { buildPickup } from './pickup'
export type { Pickup } from './pickup'
export { samePath } from './paths'
export { defaultSkillsTarget, installSkills, skillsSourceDir, skillsStatus, uninstallSkills } from './skills'
export type { SkillAction, SkillResult, SkillState, SkillStatus } from './skills'
export { initRepo, renderWorkLogging, upsertWorkLoggingBlock } from './init'
export type { InitOptions, InitResult, InitStep } from './init'
export { buildSessionContext, checkWork, hookCommand, hooksStatus, installHooks, settingsFile, startSession, stopCheck, uninstallHooks } from './hooks'
export type { WorkCheck } from './hooks'
export { buildLog, parseNotes, parseSince, resolveAuthor } from './log'
export type { LogEntry, LogOptions, ParsedNote } from './log'
export { blockedTasks, blockersOf, buildGraph, isResolved, readyTasks, taskId, tree, wouldCreateCycle } from './deps'
export type { Blocker, DepTask, Graph, TreeNode } from './deps'
