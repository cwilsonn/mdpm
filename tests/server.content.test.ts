import { strict as assert } from 'node:assert'
import { join, resolve } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import { contentPath, contentRoot } from '../server/utils/content'

const original = process.env.MDPM_CONTENT_PATH
afterEach(() => {
  if (original === undefined) delete process.env.MDPM_CONTENT_PATH
  else process.env.MDPM_CONTENT_PATH = original
})

// The web app/API and the CLI/MCP must share one content root (they used to diverge).
describe('server content root', () => {
  it('defaults to <cwd>/content when MDPM_CONTENT_PATH is unset', () => {
    delete process.env.MDPM_CONTENT_PATH
    assert.equal(contentRoot(), join(process.cwd(), 'content'))
  })

  it('honors MDPM_CONTENT_PATH', () => {
    process.env.MDPM_CONTENT_PATH = '/srv/mdpm-data'
    assert.equal(contentRoot(), '/srv/mdpm-data')
    assert.equal(contentPath('projects', 'x'), '/srv/mdpm-data/projects/x')
  })

  it('resolves a relative override', () => {
    process.env.MDPM_CONTENT_PATH = 'some/dir'
    assert.equal(contentRoot(), resolve('some/dir'))
  })

  it('treats an empty value as unset', () => {
    process.env.MDPM_CONTENT_PATH = ''
    assert.equal(contentRoot(), join(process.cwd(), 'content'))
  })
})
