import type { ArgsDef, CommandDef } from 'citty'
import { TASK_PRIORITIES, TASK_STATUSES } from '../lib/core'
import { createContext } from './context'

// Shell completion engine. The scripts from `mdpm completions <shell>` call `mdpm __complete -- <words>`,
// which walks the real command tree (so it can't drift from the CLI) and fills in project, task, doc,
// and enum values from live data.

export interface Candidate {
  value: string
  description?: string
}

/** Returned instead of candidates when the shell should complete file names. */
export const FILES = Symbol('files')

type Def = CommandDef<any>
type Resolvable<T> = T | Promise<T> | (() => T | Promise<T>)

const resolve = async <T>(value: Resolvable<T>): Promise<T> => typeof value === 'function' ? await (value as () => T | Promise<T>)() : await value

async function subCommandsOf(cmd: Def): Promise<Record<string, Def> | undefined> {
  if (!cmd.subCommands) return undefined
  const raw = await resolve(cmd.subCommands)
  return Object.fromEntries(await Promise.all(Object.entries(raw).map(async ([name, sub]) => [name, await resolve(sub as Resolvable<Def>)])))
}

async function argsOf(cmd: Def): Promise<ArgsDef> {
  return cmd.args ? await resolve(cmd.args) as ArgsDef : {}
}

const describe = async (cmd: Def) => (cmd.meta ? (await resolve(cmd.meta)).description : undefined)
const hidden = async (cmd: Def) => !!(cmd.meta && (await resolve(cmd.meta)).hidden)

// Flags that take a file system path rather than a known value.
const PATH_FLAGS = new Set(['target', 'content-path'])

const enumValues = (flag: string, path: string[]): readonly string[] | undefined => {
  if (path[0] === 'task') {
    if (flag === 'status') return TASK_STATUSES
    if (flag === 'priority') return TASK_PRIORITIES
  }
  if (flag === 'default-priority') return TASK_PRIORITIES
  return undefined
}

function valueOfFlag(tokens: string[], name: string): string | undefined {
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === `--${name}`) return tokens[i + 1]
    if (tokens[i]!.startsWith(`--${name}=`)) return tokens[i]!.slice(name.length + 3)
  }
  return undefined
}

export async function complete(root: Def, words: string[]): Promise<Candidate[] | typeof FILES> {
  const current = words.at(-1) ?? ''
  const tokens = words.slice(0, -1)

  // Walk to the command being completed, collecting positionals and a pending flag value.
  let node = root
  const path: string[] = []
  const positionals: string[] = []
  let pendingFlag: { name: string; type?: string; options?: readonly string[] } | undefined
  for (const token of tokens) {
    if (pendingFlag) { pendingFlag = undefined; continue }
    if (token.startsWith('-')) {
      const name = token.replace(/^-+/, '').split('=')[0]!
      const args = await argsOf(node)
      const def = Object.entries(args).find(([key, d]) => key === name || [(d as { alias?: string | string[] }).alias].flat().includes(name))
      const d = def?.[1] as { type?: string; options?: readonly string[] } | undefined
      if (d && d.type !== 'boolean' && d.type !== 'positional' && !token.includes('=')) pendingFlag = { name: def![0], type: d.type, options: d.options }
      continue
    }
    const subs = positionals.length === 0 ? await subCommandsOf(node) : undefined
    if (subs?.[token]) { node = subs[token]!; path.push(token); continue }
    positionals.push(token)
  }

  const ctx = createContext({})
  const safely = async <T>(fn: () => T | Promise<T>, fallback: T): Promise<T> => { try { return await fn() } catch { return fallback } }

  const projectProvider = (): Promise<Candidate[]> => safely(() => ctx.core.listProjects({ includeArchived: true }).map(p => ({ value: p.slug, description: p.title })), [])
  const scopeProject = () => valueOfFlag(tokens, 'project') ?? (tokens.includes('--all') ? undefined : safely(() => ctx.inferProject()?.slug, undefined))
  const taskProvider = async (): Promise<Candidate[]> => {
    const project = await scopeProject()
    return safely(() => ctx.core.listTasks({ project, includeArchived: true }).map(t => ({ value: project ? t.slug : `${t.project}/${t.slug}`, description: t.title })), [])
  }
  const docProvider = async (): Promise<Candidate[]> => {
    const standalone = tokens.includes('--standalone')
    const project = standalone ? undefined : await scopeProject()
    return safely(() => ctx.core.listDocs({ project, standalone, includeArchived: true }).map(d => ({ value: d.slug, description: d.title })), [])
  }

  // 1. A value for the flag just typed.
  if (pendingFlag) {
    const { name, options } = pendingFlag
    if (PATH_FLAGS.has(name)) return FILES
    if (options?.length) return options.map(value => ({ value }))
    if (name === 'project') return projectProvider()
    if (name === 'parent' && path[0] === 'doc') return docProvider()
    const values = enumValues(name, path)
    return values ? values.map(value => ({ value })) : []
  }

  // 2. A flag name.
  if (current.startsWith('-')) {
    const args = await argsOf(node)
    const out: Candidate[] = [{ value: '--help', description: 'Show usage' }]
    for (const [name, d] of Object.entries(args) as [string, { type?: string; description?: string; alias?: string | string[] }][]) {
      if (d.type === 'positional') continue
      out.push({ value: `--${name}`, description: d.description })
      for (const alias of [d.alias].flat().filter(Boolean) as string[]) out.push({ value: alias.length === 1 ? `-${alias}` : `--${alias}`, description: d.description })
    }
    return out
  }

  // 3. A subcommand.
  const subs = await subCommandsOf(node)
  if (subs && positionals.length === 0) {
    const entries = await Promise.all(Object.entries(subs).map(async ([name, sub]) => ({ name, sub, hide: await hidden(sub) })))
    return Promise.all(entries.filter(e => !e.hide).map(async e => ({ value: e.name, description: await describe(e.sub) })))
  }

  // 4. A positional argument.
  const positionalDefs = Object.entries(await argsOf(node)).filter(([, d]) => (d as { type?: string }).type === 'positional')
  const target = positionalDefs[positionals.length]?.[0]
  if (target === 'ref') {
    switch (path[0]) {
      case 'task': return taskProvider()
      case 'doc': return docProvider()
      case 'project':
      case 'pickup': return projectProvider()
    }
  }
  return []
}

// Wire format for the shell scripts: one candidate per line, `value<TAB>description`; a lone `:files` line
// asks the shell for file name completion.
export function renderCandidates(result: Candidate[] | typeof FILES) {
  if (result === FILES) return ':files'
  return result.map(c => c.description ? `${c.value}\t${c.description.replace(/[\t\n]+/g, ' ')}` : c.value).join('\n')
}

const SCRIPTS = {
  zsh: `#compdef mdpm
# Completion for mdpm. Install: mdpm completions zsh > "\${fpath[1]}/_mdpm"   (or: source <(mdpm completions zsh))
_mdpm() {
  local -a lines items
  lines=("\${(@f)$(mdpm __complete -- "\${(@)words[2,CURRENT]}" 2>/dev/null)}")
  if [[ "\${lines[1]}" == ":files" ]]; then
    _files
    return
  fi
  items=()
  local l v d
  for l in "\${lines[@]}"; do
    [[ -z "$l" ]] && continue
    v="\${l%%$'\\t'*}"
    d="\${l#*$'\\t'}"
    [[ "$d" == "$l" ]] && d=""
    v="\${v//:/\\\\:}"
    items+=("\${v}\${d:+:$d}")
  done
  _describe -t mdpm 'mdpm' items
}
if [ "$funcstack[1]" = "_mdpm" ]; then
  _mdpm "$@"
else
  compdef _mdpm mdpm
fi
`,
  bash: `# Completion for mdpm. Install: mdpm completions bash > ~/.local/share/bash-completion/completions/mdpm
# (or add to ~/.bashrc: source <(mdpm completions bash))
_mdpm() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  # Copy the words before touching IFS: bash 3.2 collapses a quoted slice into one word otherwise.
  local -a words=("\${COMP_WORDS[@]:1:COMP_CWORD}")
  local out
  out=$(mdpm __complete -- "\${words[@]}" 2>/dev/null)
  if [[ "$out" == ":files" ]]; then
    COMPREPLY=($(compgen -f -- "$cur"))
    return
  fi
  local IFS=$'\\n'
  COMPREPLY=($(compgen -W "$(printf '%s\\n' "$out" | cut -f1)" -- "$cur"))
}
complete -F _mdpm mdpm
`,
  fish: `# Completion for mdpm. Install: mdpm completions fish > ~/.config/fish/completions/mdpm.fish
function __mdpm_complete
    set -l words (commandline -opc)[2..-1]
    set -l cur (commandline -ct)
    set -l out (mdpm __complete -- $words "$cur" 2>/dev/null)
    if test "$out[1]" = ":files"
        __fish_complete_path "$cur"
    else
        printf '%s\\n' $out
    end
end
complete -c mdpm -f -a '(__mdpm_complete)'
`,
} as const

export type Shell = keyof typeof SCRIPTS
export const SHELLS = Object.keys(SCRIPTS) as Shell[]
export const completionScript = (shell: Shell) => SCRIPTS[shell]
