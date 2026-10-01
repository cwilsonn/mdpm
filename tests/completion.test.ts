import { strict as assert } from 'node:assert'
import { spawnSync } from 'node:child_process'
import { chmodSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { root } from '../cli/index'
import { complete, FILES, renderCandidates, type Candidate } from '../cli/completion'
import { FIXTURE_CONTENT, isolatedEnv, REPO, runCli, scratchDir } from './helpers'

const scratch = scratchDir()
after(scratch.cleanup)

// The engine reads config from the environment, like the real CLI does.
const saved = process.env.MDPM_CONTENT_PATH
before(() => { process.env.MDPM_CONTENT_PATH = FIXTURE_CONTENT })
after(() => {
  if (saved === undefined) delete process.env.MDPM_CONTENT_PATH
  else process.env.MDPM_CONTENT_PATH = saved
})

const values = async (...words: string[]) => {
  const result = await complete(root, words)
  assert.notEqual(result, FILES)
  return (result as Candidate[]).map(c => c.value)
}

describe('completion engine', () => {
  it('offers the top-level commands, and never the hidden hook', async () => {
    const all = await values('')
    for (const name of ['task', 'project', 'doc', 'pickup', 'start', 'completions']) assert.ok(all.includes(name), name)
    assert.ok(!all.includes('__complete'))
  })

  it('offers subcommands with descriptions', async () => {
    const result = await complete(root, ['task', '']) as Candidate[]
    const names = result.map(c => c.value)
    for (const name of ['list', 'search', 'show', 'add', 'done']) assert.ok(names.includes(name), name)
    assert.match(result.find(c => c.value === 'show')!.description!, /Show one task/)
  })

  it('offers flags, including aliases, but not positionals', async () => {
    const flags = await values('task', 'delete', '--')
    assert.ok(flags.includes('--project') && flags.includes('--json') && flags.includes('--yes') && flags.includes('-y') && flags.includes('--help'))
    assert.ok(!flags.includes('--ref'))
  })

  it('completes enum flag values', async () => {
    assert.deepEqual(await values('task', 'list', '--status', ''), ['todo', 'in-progress', 'in-review', 'done', 'blocked', 'on-hold'])
    assert.deepEqual(await values('task', 'set', 'x', '--priority', ''), ['low', 'medium', 'high', 'urgent'])
    assert.deepEqual(await values('project', 'create', 'x', '--default-priority', ''), ['low', 'medium', 'high', 'urgent'])
  })

  it('completes --project with live project slugs and titles', async () => {
    const result = await complete(root, ['task', 'show', '--project', '']) as Candidate[]
    assert.deepEqual(result.map(c => c.value).sort(), ['alpha', 'beta', 'gamma'])
    assert.equal(result.find(c => c.value === 'alpha')!.description, 'Alpha')
  })

  it('completes task refs within the --project scope, archived included', async () => {
    const refs = await values('task', 'show', '--project', 'alpha', '')
    assert.ok(refs.includes('write-parser') && refs.includes('old-idea'))
    assert.ok(!refs.includes('beta-task'))
    assert.deepEqual(await values('task', 'show', '--project=beta', ''), ['beta-task', 'shared-task'])
  })

  it('qualifies task refs with the project when scope is --all', async () => {
    const refs = await values('task', 'done', '--all', '')
    assert.ok(refs.includes('alpha/write-parser') && refs.includes('beta/shared-task'))
  })

  it('completes doc refs, project and standalone', async () => {
    assert.ok((await values('doc', 'show', '--project', 'alpha', '')).includes('architecture'))
    assert.deepEqual(await values('doc', 'show', '--standalone', ''), ['standalone-guide'])
  })

  it('completes project refs for project and pickup commands', async () => {
    assert.ok((await values('project', 'show', '')).includes('alpha'))
    assert.ok((await values('pickup', '')).includes('beta'))
  })

  it('offers nothing for free-text positionals', async () => {
    assert.deepEqual(await values('task', 'add', '--project', 'alpha', ''), [])
    assert.deepEqual(await values('task', 'note', '--project', 'alpha', 'write-parser', ''), [])
  })

  it('asks the shell for files on path flags', async () => {
    assert.equal(await complete(root, ['task', 'list', '--content-path', '']), FILES)
    assert.equal(await complete(root, ['skills', 'install', '--target', '']), FILES)
  })

  it('does not choke on an unknown command or a boolean flag before the cursor', async () => {
    assert.deepEqual(await values('nonsense', ''), [])
    assert.ok((await values('task', 'show', '--all', '')).length > 0)
  })

  it('renders the wire format', () => {
    assert.equal(renderCandidates([{ value: 'a', description: 'x\ty' }, { value: 'b' }]), 'a\tx y\nb')
    assert.equal(renderCandidates(FILES), ':files')
  })
})

const cli = (args: string[]) => runCli(args, { scratch: scratch.dir })

describe('the hidden __complete hook and the scripts', () => {
  it('prints candidates and treats --help as an ordinary word', async () => {
    const r = await cli(['__complete', '--', 'task', ''])
    assert.equal(r.code, 0)
    assert.match(r.stdout, /^list\t/)
    const help = await cli(['__complete', '--', '--help'])
    assert.equal(help.code, 0)
    assert.doesNotMatch(help.stdout, /USAGE/)
  })

  it('prints a script per shell and rejects unknown shells', async () => {
    assert.match((await cli(['completions', 'zsh'])).stdout, /^#compdef mdpm/)
    assert.match((await cli(['completions', 'bash'])).stdout, /complete -F _mdpm mdpm/)
    assert.match((await cli(['completions', 'fish'])).stdout, /complete -c mdpm/)
    const bad = await cli(['completions', 'powershell'])
    assert.equal(bad.code, 2)
    assert.match(bad.stderr, /zsh, bash, fish/)
  })

  const syntax = (shell: string, flag: string, script: string) => {
    const which = spawnSync('which', [shell])
    if (which.status !== 0) return undefined
    return spawnSync(shell, [flag, '-c', script], { encoding: 'utf8' })
  }

  it('generates syntactically valid bash and zsh', async () => {
    for (const [shell, flag] of [['bash', '-n'], ['zsh', '-n']] as const) {
      const script = (await cli(['completions', shell])).stdout
      const file = join(scratch.dir, `comp.${shell}`)
      writeFileSync(file, script)
      const which = spawnSync('which', [shell])
      if (which.status !== 0) continue
      const check = spawnSync(shell, [flag, file], { encoding: 'utf8' })
      assert.equal(check.status, 0, `${shell} rejected the script: ${check.stderr}`)
    }
    void syntax
  })

  it('bash: the generated function completes subcommands, flags, and live slugs', async () => {
    if (spawnSync('which', ['bash']).status !== 0) return
    const bin = join(scratch.dir, 'bin')
    spawnSync('mkdir', ['-p', bin])
    writeFileSync(join(bin, 'mdpm'), `#!/bin/sh\nexec node ${join(REPO, 'bin/mdpm.mjs')} "$@"\n`)
    chmodSync(join(bin, 'mdpm'), 0o755)
    const run = (words: string[], cword: number) => spawnSync('bash', ['-c', `eval "$(mdpm completions bash)"; COMP_WORDS=(${words.map(w => `'${w}'`).join(' ')}); COMP_CWORD=${cword}; _mdpm; printf '%s\\n' "\${COMPREPLY[@]}"`], {
      encoding: 'utf8',
      env: { ...isolatedEnv(scratch.dir), PATH: `${bin}:${process.env.PATH}` },
      cwd: scratch.dir,
    }).stdout.trim().split('\n').filter(Boolean)

    assert.deepEqual(run(['mdpm', 'task', 'sh'], 2), ['show'])
    assert.deepEqual(run(['mdpm', 'task', 'list', '--sta'], 3), ['--status'])
    assert.deepEqual(run(['mdpm', 'task', 'show', '--project', 'al'], 4), ['alpha'])
    assert.deepEqual(run(['mdpm', 'task', 'show', '--project', 'alpha', 'write-p'], 5), ['write-parser'])
    assert.deepEqual(run(['mdpm', 'task', 'list', '--status', 'in-'], 4), ['in-progress', 'in-review'])
  })

  it('zsh: the generated function turns candidates into described items and falls back to files', () => {
    if (spawnSync('which', ['zsh']).status !== 0) return
    const bin = join(scratch.dir, 'zbin')
    spawnSync('mkdir', ['-p', bin])
    writeFileSync(join(bin, 'mdpm'), `#!/bin/sh\nexec node ${join(REPO, 'bin/mdpm.mjs')} "$@"\n`)
    chmodSync(join(bin, 'mdpm'), 0o755)
    // Stub zsh's completion helpers: _describe receives the items array by name as its 4th argument.
    const script = `compdef() { :; }; _describe() { print -l -- "\${(@P)4}"; }; _files() { echo FILES; }
eval "$(mdpm completions zsh)"
t() { words=("$@"); CURRENT=$#words; _mdpm; }
t mdpm task show --project ''; t mdpm task list --content-path ''; t mdpm task sh`
    const out = spawnSync('zsh', ['-f', '-c', script], { encoding: 'utf8', env: { ...isolatedEnv(scratch.dir), PATH: `${bin}:${process.env.PATH}` }, cwd: scratch.dir }).stdout.split('\n')
    assert.ok(out.includes('alpha:Alpha'), 'project slug with its title as description')
    assert.ok(out.includes('FILES'), 'path flags fall back to file completion')
    assert.ok(out.some(l => l.startsWith('show:Show one task')), 'subcommands with descriptions')
  })
})
