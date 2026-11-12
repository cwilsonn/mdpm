import { strict as assert } from 'node:assert'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { commandName, readUsage, recordUsage, summarizeUsage, usageLogPath } from '../lib/core'
import { runCli, scratchDir } from './helpers'

const scratch = scratchDir()
after(scratch.cleanup)
const cli = (args: string[], env: Record<string, string | undefined> = {}) => runCli(args, { scratch: scratch.dir, env })

describe('commandName', () => {
  it('keeps two words for command groups and one otherwise, never positional arguments', () => {
    assert.equal(commandName(['task', 'list', '--json']), 'task list')
    assert.equal(commandName(['task', 'note', 'my-ref', 'secret text']), 'task note')
    assert.equal(commandName(['pickup', 'mdpm']), 'pickup')
    assert.equal(commandName(['--version']), '')
  })
})

describe('usage log', () => {
  it('records name and size only, and summarizes heaviest first', () => {
    const prev = process.env.MDPM_STATE_DIR
    process.env.MDPM_STATE_DIR = join(scratch.dir, 'unit-state')
    try {
      recordUsage({ surface: 'mcp', name: 'list_tasks', chars: 4000 })
      recordUsage({ surface: 'mcp', name: 'list_tasks', chars: 8000 })
      recordUsage({ surface: 'cli', name: 'pickup', chars: 400 })
      const rows = summarizeUsage(readUsage())
      assert.deepEqual(rows.map(r => r.name), ['list_tasks', 'pickup'])
      assert.deepEqual([rows[0]!.calls, rows[0]!.tokens, rows[0]!.avgTokens, rows[0]!.maxTokens], [2, 3000, 1500, 2000])
      assert.deepEqual(Object.keys(JSON.parse(readFileSync(usageLogPath(), 'utf8').split('\n')[0]!)).sort(), ['at', 'chars', 'name', 'surface', 'tokens'])
    }
    finally {
      if (prev === undefined) delete process.env.MDPM_STATE_DIR
      else process.env.MDPM_STATE_DIR = prev
    }
  })

  it('MDPM_USAGE_LOG=0 turns it off', () => {
    const prev = process.env.MDPM_STATE_DIR
    process.env.MDPM_STATE_DIR = join(scratch.dir, 'off-state')
    process.env.MDPM_USAGE_LOG = '0'
    try {
      recordUsage({ surface: 'cli', name: 'x', chars: 1 })
      assert.equal(existsSync(usageLogPath()), false)
    }
    finally {
      delete process.env.MDPM_USAGE_LOG
      if (prev === undefined) delete process.env.MDPM_STATE_DIR
      else process.env.MDPM_STATE_DIR = prev
    }
  })
})

describe('mdpm usage', () => {
  it('logs CLI calls with their stdout size and reports them without logging itself', async () => {
    const list = await cli(['task', 'list', '--project', 'alpha', '--json'])
    assert.equal(list.code, 0)
    const r = await cli(['usage', '--json'])
    assert.equal(r.code, 0)
    const row = r.json.rows.find((x: any) => x.name === 'task list')
    assert.ok(row, 'task list is logged')
    assert.equal(row.calls, 1)
    assert.ok(row.tokens > 0)
    assert.equal(r.json.rows.some((x: any) => x.name === 'usage'), false)
    assert.doesNotMatch(readFileSync(join(scratch.dir, 'state', 'usage.jsonl'), 'utf8'), /alpha/)
  })
})
