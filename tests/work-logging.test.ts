import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { REPO } from './helpers'

const read = (...parts: string[]) => readFileSync(join(REPO, ...parts), 'utf8')

describe('work-logging convention', () => {
  const template = read('templates/work-logging.md')

  it('the template is a marked block with a project placeholder', () => {
    assert.match(template, /^<!-- mdpm:work-logging:start -->\n/)
    assert.match(template, /<!-- mdpm:work-logging:end -->\n$/)
    assert.ok(template.includes('{{project}}'))
  })

  it("mdpm's own CLAUDE.md carries the template, with the project filled in", () => {
    assert.ok(read('CLAUDE.md').includes(template.replaceAll('{{project}}', 'mdpm')), 'CLAUDE.md is out of sync with templates/work-logging.md')
  })

  it('only mentions CLI commands that exist', () => {
    for (const command of ['task search', 'task list', 'task add', 'task set', 'task note', 'task done', 'task archive']) {
      assert.ok(template.includes(`mdpm ${command}`), command)
    }
  })
})
