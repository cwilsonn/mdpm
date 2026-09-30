import { homedir } from 'node:os'
import { defineCommand } from 'citty'
import { REPO_ROOT } from '../../lib/core'
import { createContext, globalArgs } from '../context'
import { emit, table } from '../output'

const tildify = (p: string) => p.startsWith(homedir()) ? `~${p.slice(homedir().length)}` : p

const show = defineCommand({
  meta: { name: 'show', description: 'Print resolved config values and where each came from' },
  args: { ...globalArgs },
  async run({ args }) {
    const ctx = createContext(args)
    const { config, sources, autoStart, configFile, configFileFound } = ctx.loadedConfig
    const port = Number(new URL(config.baseUrl).port) || (new URL(config.baseUrl).protocol === 'https:' ? 443 : 80)
    const project = ctx.inferProject() ?? null
    const result = {
      contentPath: { value: config.contentPath, source: sources.contentPath },
      baseUrl: { value: config.baseUrl, source: sources.baseUrl },
      port: { value: port, source: sources.baseUrl },
      autoStart: { value: autoStart.value, source: autoStart.source },
      repoRoot: { value: REPO_ROOT.replace(/\/$/, ''), source: 'derived' },
      configFile: { value: configFile, found: configFileFound },
      project,
    }
    emit(ctx.json, result, () => table([
      ['contentPath', result.contentPath.value, result.contentPath.source],
      ['baseUrl', result.baseUrl.value, result.baseUrl.source],
      ['port', String(port), `from baseUrl (${sources.baseUrl})`],
      ['autoStart', String(autoStart.value), autoStart.source],
      ['repoRoot', result.repoRoot.value, 'derived from bin location'],
      ['configFile', tildify(configFile), configFileFound ? 'found' : 'not found'],
      ['project', project?.slug ?? '-', project ? `${project.via}: ${project.detail}` : 'no match for cwd'],
    ].map(([key, value, note]) => [key!, value!, `(${note})`])))
  },
})

export default defineCommand({
  meta: { name: 'config', description: 'Inspect CLI configuration' },
  subCommands: { show },
})
