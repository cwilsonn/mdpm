import { strict as assert } from 'node:assert'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import matter from 'gray-matter'
import { REPO } from './helpers'

const dir = join(REPO, 'skills')
const skills = readdirSync(dir).filter(f => f.endsWith('.md')).map(f => ({ name: f.replace(/\.md$/, ''), ...matter(readFileSync(join(dir, f), 'utf8')) }))
const modelOf = (name: string) => skills.find(s => s.name === name)!.data.model

describe('skill models', () => {
  it('there are two skills: pickup and handoff', () => {
    assert.deepEqual(skills.map(s => s.name).sort(), ['handoff', 'pickup'])
  })

  it('handoff summarises the whole conversation into durable notes, so it runs on the strong model', () => {
    assert.equal(modelOf('handoff'), 'opus')
  })

  it('pickup only formats what the CLI returns and keeps the session model', () => {
    assert.equal(modelOf('pickup'), undefined)
  })

  it('every pinned model is a valid alias, so a typo cannot be silently ignored', () => {
    for (const s of skills.filter(s => s.data.model !== undefined)) assert.ok(['haiku', 'sonnet', 'opus', 'fable', 'inherit'].includes(s.data.model), `${s.name}: ${s.data.model}`)
  })

  it('pinned skills keep a description, since the first line is no longer the command summary', () => {
    for (const s of skills.filter(s => s.data.model !== undefined)) assert.ok(typeof s.data.description === 'string' && s.data.description.length > 0, s.name)
  })
})
