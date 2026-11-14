import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { buildPickup, createCore, createLifecycle, DEFAULT_LIMIT, DEFAULT_MAX_CHARS, DOC_FIELDS, DOC_LIST_FIELDS, docRow, loadConfig, paginate, parseFields, pickFields, recordAsyncFailure, recordUsage, REPO_ROOT, shapeDoc, shapeTask, TASK_FIELDS, TASK_LIST_FIELDS, taskRow, toTsv } from '../lib/core'
import type { BatchItem } from '../lib/core'

// Same source of truth as the CLI, so release-please keeps both in step.
const version: string = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).version

const loaded = loadConfig()
// Opt-in (MDPM_AUTO_START=1 or `autoStart` in the config file): a write that finds the server down
// starts it and retries. Unlike the CLI, this long-lived process never stops it again.
const lifecycle = createLifecycle(loaded.config)

// Shared by every list/search tool: small pages, chosen fields, compact output.
const LIST_PROPS = {
  limit: { type: 'number', description: `Max rows (default ${DEFAULT_LIMIT}; 0 = all). The result says how many more there are and the offset for the next page.` },
  offset: { type: 'number', description: 'Skip this many rows (the nextOffset of the previous page).' },
  fields: { type: 'array', items: { type: 'string' }, description: 'Columns to include; ["*"] for all. Fewer fields = fewer tokens.' },
  format: { type: 'string', enum: ['tsv', 'json'], description: 'tsv (default): a "# total=.. returned=.. next=.." line, a header, then tab-separated rows. json: {total, returned, offset, nextOffset, items}, compact.' },
} as const

interface ListArgs { limit?: number; offset?: number; fields?: string[]; format?: 'tsv' | 'json' }

function listResult(rows: Record<string, unknown>[], args: ListArgs, allowed: readonly string[], fallback: readonly string[]) {
  const fields = parseFields(args.fields, allowed, fallback)
  const page = paginate(rows, { limit: args.limit, offset: args.offset })
  if (args.format === 'json') {
    return { ...page, items: page.items.map(r => pickFields(r, fields)) }
  }
  const head = `# total=${page.total} returned=${page.returned} offset=${page.offset} next=${page.nextOffset ?? 'none'}`
  return `${head}\n${toTsv(page.items, fields)}`
}

// Fire-and-forget: the tool returns the id at once and the write completes in the background. A failure has
// nobody to tell, so it is recorded (ping and `mdpm status` report it). The change may not be readable yet.
const ASYNC_PROP = { type: 'boolean', description: 'Return the id immediately and do the write in the background. Failures are recorded and shown by ping / mdpm status; the change may not be visible to an immediate read.' } as const

function inBackground(what: string, work: Promise<unknown>) {
  work.catch(err => recordAsyncFailure({ source: 'mcp', what, error: err instanceof Error ? err.message : String(err) }))
}

const core = createCore(loaded.config, loaded.autoStart.value ? { onUnreachable: async () => { await lifecycle.start() } } : {})

// ─── Server ──────────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'mdpm', version },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'pickup',
      description: 'One-call session briefing for a project: open tasks (capped per status), blockers, what changed since the last handoff, docs, the latest session notes (capped) and a suggested focus. Prefer this over assembling list_tasks + list_docs + get_doc. delta=true returns only the changes since the last handoff plus blockers.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Project slug.' },
          delta: { type: 'boolean', description: 'Only what changed since the last handoff, plus blockers.' },
          full: { type: 'boolean', description: 'No caps: every task and doc, the whole last session notes.' },
        },
        required: ['project'],
      },
    },
    {
      name: 'list_projects',
      description: 'List all projects with metadata and counts. Archived projects are excluded unless includeArchived is set.',
      inputSchema: {
        type: 'object',
        properties: {
          includeArchived: { type: 'boolean', description: 'Include archived projects. Defaults to false.' },
        },
      },
    },
    {
      name: 'get_project',
      description: 'Get full metadata for a single project.',
      inputSchema: {
        type: 'object',
        properties: { slug: { type: 'string' } },
        required: ['slug'],
      },
    },
    {
      name: 'list_tasks',
      description: `List or search tasks as a compact page (default ${DEFAULT_LIMIT} rows, summary columns only: no bodies). Filter by project and status; query searches titles and bodies and adds a match column. Archived tasks are excluded unless includeArchived is set. get_task returns one task's body.`,
      inputSchema: {
        type: 'object',
        properties: {
          ...LIST_PROPS,
          project: { type: 'string', description: 'Project slug. Omit for all projects.' },
          query: { type: 'string', description: 'Full-text search over titles and bodies.' },
          status: {
            type: 'array',
            items: { type: 'string', enum: ['todo', 'in-progress', 'in-review', 'done', 'blocked', 'on-hold'] },
            description: 'Filter by status values. Omit for all.',
          },
          includeArchived: { type: 'boolean', description: 'Include archived tasks. Defaults to false.' },
        },
      },
    },
    {
      name: 'get_task',
      description: `Get one task with its description. The body is capped (spec up to ${DEFAULT_MAX_CHARS} chars, newest 3 notes shortened) and says what was left out; pass full for everything.`,
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string' },
          slug: { type: 'string' },
          full: { type: 'boolean', description: 'Return the whole body, every note included.' },
          notes: { type: 'number', description: 'How many of the newest notes to include (default 3).' },
        },
        required: ['project', 'slug'],
      },
    },
    {
      name: 'create_task',
      description: 'Create a new task in a project.',
      inputSchema: {
        type: 'object',
        properties: {
          async: ASYNC_PROP,
          project: { type: 'string' },
          title: { type: 'string' },
          status: { type: 'string', enum: ['todo', 'in-progress', 'in-review', 'done', 'blocked', 'on-hold'] },
          priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
          tags: { type: 'array', items: { type: 'string' } },
          assignees: { type: 'array', items: { type: 'string' } },
          due: { type: 'string', description: 'YYYY-MM-DD' },
          description: { type: 'string', description: 'Markdown body. Put related links (PRs, tickets) in a "## Links" list in the body.' },
          note: { type: 'string', description: 'Appended as a timestamped note in the same write.' },
          noteAuthor: { type: 'string', description: 'Author of the note; defaults to $MDPM_AUTHOR, else "claude".' },
        },
        required: ['project', 'title'],
      },
    },
    {
      name: 'update_task',
      description: 'Update an existing task: fields, a note (appended with a timestamp, same write), or archived.',
      inputSchema: {
        type: 'object',
        properties: {
          async: ASYNC_PROP,
          project: { type: 'string' },
          slug: { type: 'string' },
          title: { type: 'string' },
          status: { type: 'string', enum: ['todo', 'in-progress', 'in-review', 'done', 'blocked', 'on-hold'] },
          priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
          tags: { type: 'array', items: { type: 'string' } },
          assignees: { type: 'array', items: { type: 'string' } },
          due: { type: 'string' },
          description: { type: 'string', description: 'Markdown body. Put related links (PRs, tickets) in a "## Links" list in the body.' },
          note: { type: 'string', description: 'Appended as a timestamped note in the same write (status + note in one call).' },
          noteAuthor: { type: 'string', description: 'Author of the note; defaults to $MDPM_AUTHOR, else "claude".' },
          archived: { type: 'boolean', description: 'true archives the task, false restores it.' },
        },
        required: ['project', 'slug'],
      },
    },
    {
      name: 'batch_tasks',
      description: 'Apply several task writes in ONE call (up to 100, in order; a failing item does not stop the rest). Use it to record a whole session at once instead of one call per task. Items: {op:"update", ref, status?, priority?, note?, ...}, {op:"note", ref, note}, {op:"create", title, status?, priority?, description?}. ref is a slug, unique fragment or project/slug. Returns only {ok, failed, results:[{index, ok, id, status | error}]}.',
      inputSchema: {
        type: 'object',
        properties: {
          async: ASYNC_PROP,
          project: { type: 'string', description: 'Default project for items that do not name one.' },
          ops: {
            type: 'array',
            minItems: 1,
            maxItems: 100,
            items: {
              type: 'object',
              properties: {
                op: { type: 'string', enum: ['create', 'update', 'note'] },
                ref: { type: 'string', description: 'update/note: the task (slug, fragment or project/slug).' },
                project: { type: 'string' },
                title: { type: 'string', description: 'create: the title; update: a new title.' },
                status: { type: 'string', enum: ['todo', 'in-progress', 'in-review', 'done', 'blocked', 'on-hold'] },
                priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
                tags: { type: 'array', items: { type: 'string' } },
                description: { type: 'string', description: 'Markdown body (replaces it on update).' },
                note: { type: 'string', description: 'Appended as a timestamped note in the same write.' },
                author: { type: 'string', description: 'Note author; defaults to $MDPM_AUTHOR, else "claude".' },
              },
              required: ['op'],
            },
          },
        },
        required: ['ops'],
      },
    },
    {
      name: 'start_task',
      description: 'Begin a unit of work in ONE call: resume the open task whose slug or title exactly matches, or create it, and set it in-progress. Replaces search + create + update. Returns {id, status, created}.',
      inputSchema: {
        type: 'object',
        properties: {
          async: ASYNC_PROP,
          project: { type: 'string' },
          title: { type: 'string', description: 'Task title, or the exact slug of an existing task.' },
          priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
          tags: { type: 'array', items: { type: 'string' } },
          description: { type: 'string', description: 'Scope and why (used only when it creates the task).' },
        },
        required: ['project', 'title'],
      },
    },
    {
      name: 'list_docs',
      description: `List or search docs as a compact page (default ${DEFAULT_LIMIT} rows, no bodies). Pass project to scope to a project; omit it for all docs including standalone. query searches titles and bodies. Archived docs are excluded unless includeArchived is set.`,
      inputSchema: {
        type: 'object',
        properties: {
          ...LIST_PROPS,
          project: { type: 'string', description: 'Project slug. Omit for all docs (project + standalone).' },
          query: { type: 'string', description: 'Full-text search over titles and bodies.' },
          standalone: { type: 'boolean', description: 'Set true to list only standalone (non-project) docs.' },
          includeArchived: { type: 'boolean', description: 'Include archived docs and descendants of archived folders. Defaults to false.' },
        },
      },
    },
    {
      name: 'get_doc',
      description: `Get a doc with its markdown body. The body is capped at ${DEFAULT_MAX_CHARS} chars; when cut, the result gives nextOffset to continue. Omit project for a standalone doc.`,
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Project slug. Omit for standalone doc.' },
          slug: { type: 'string' },
          maxChars: { type: 'number', description: `Cap on the body (default ${DEFAULT_MAX_CHARS}; 0 = all).` },
          offset: { type: 'number', description: 'Start the body at this character (continue a cut body).' },
        },
        required: ['slug'],
      },
    },
    {
      name: 'upsert_doc',
      description: 'Create or update a doc. Omit project for a standalone doc. If slug exists it will be updated; otherwise a new doc is created.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Project slug. Omit for standalone doc.' },
          slug: { type: 'string', description: 'Existing slug to update. Omit to create new.' },
          title: { type: 'string' },
          body: { type: 'string', description: 'Full markdown body' },
          tags: { type: 'array', items: { type: 'string' } },
          parent: { type: 'string', description: 'Slug of parent doc in same scope for hierarchy.' },
        },
        required: ['title', 'body'],
      },
    },
  ],
}))

// Logs how much each tool returns (name and size only) so `mdpm usage` can rank what costs the most tokens.
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const result = await callTool(req.params.name, (req.params.arguments ?? {}) as Record<string, unknown>)
  recordUsage({ surface: 'mcp', name: req.params.name, chars: result.content.reduce((n, c) => n + c.text.length, 0) })
  return result
})

// A note without an author is credited to $MDPM_AUTHOR, else "claude".
const withNoteAuthor = (fields: Record<string, unknown>) =>
  typeof fields.note === 'string' && fields.note.trim() && !fields.noteAuthor ? { ...fields, noteAuthor: process.env.MDPM_AUTHOR || 'claude' } : fields

async function callTool(name: string, args: Record<string, unknown>) {
  // Compact by default: indentation is pure token cost. A string (the tsv list form) is sent as is.
  const text = (value: string | object) => ({
    content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value) }],
  })
  const json = (value: unknown, _pretty = false) => text(value as object)

  try {
    switch (name) {
      case 'pickup': {
        const { project, delta, full } = args as { project: string; delta?: boolean; full?: boolean }
        const p = buildPickup(core, core.resolveProject(project).slug, { full })
        return json(delta ? { project: p.project, sinceLastSession: p.sinceLastSession, blockers: p.blockers, ...(p.moreBlockers && { moreBlockers: p.moreBlockers }) } : p)
      }

      case 'list_projects':
        return json(core.listProjects(args as { includeArchived?: boolean }), true)

      case 'get_project':
        return json(core.getProject((args as { slug: string }).slug), true)

      case 'list_tasks': {
        const { query, limit, offset, fields, format, ...rest } = args as Parameters<typeof core.listTasks>[0] & { query?: string } & ListArgs
        const q = query?.trim().toLowerCase()
        const tasks = core.listTasks(rest).filter(t => !q || t.title.toLowerCase().includes(q) || t.body.toLowerCase().includes(q))
        return text(listResult(tasks.map(t => taskRow(t, q)), { limit, offset, fields, format }, TASK_FIELDS, q ? [...TASK_LIST_FIELDS, 'match'] : TASK_LIST_FIELDS))
      }

      case 'get_task': {
        const { project, slug, full, notes } = args as { project: string; slug: string; full?: boolean; notes?: number }
        return json(shapeTask(core.getTask(project, slug), { full, notes }))
      }

      case 'create_task': {
        const { project, async: later, ...rest } = args as { project: string; async?: boolean; [k: string]: unknown }
        if (later) {
          const slug = (rest.slug as string | undefined) ?? core.predictTaskSlug(project, String(rest.title))
          inBackground('create_task', core.createTask(project, withNoteAuthor({ ...rest, slug })))
          return json({ queued: true, id: `${project}/${slug}` })
        }
        return json(await core.createTask(project, withNoteAuthor(rest)))
      }

      case 'update_task': {
        const { project, slug, async: later, archived, ...fields } = args as { project: string; slug: string; async?: boolean; archived?: boolean; [k: string]: unknown }
        const rest = archived === undefined ? fields : { ...fields, archivedAt: archived ? new Date().toISOString() : null }
        if (later) {
          core.getTask(project, slug)
          inBackground('update_task', core.updateTask(project, slug, withNoteAuthor(rest)))
          return json({ queued: true, id: `${project}/${slug}` })
        }
        return json(await core.updateTask(project, slug, withNoteAuthor(rest)))
      }

      case 'batch_tasks': {
        const { project, ops, async: later } = args as { project?: string; ops: BatchItem[]; async?: boolean }
        const author = process.env.MDPM_AUTHOR || 'claude'
        const items = ops.map(o => (o.op === 'note' || (o as { note?: string }).note) ? { ...o, author: (o as { author?: string }).author?.trim() || author } as BatchItem : o)
        if (later) {
          inBackground('batch_tasks', core.batchTasks(project, items).then((r) => { if (r.failed) throw new Error(`${r.failed} of ${r.results.length} ops failed: ${r.results.filter(x => !x.ok).map(x => `#${x.index} ${x.error}`).join('; ')}`) }))
          return json({ queued: true, ops: items.length })
        }
        return json(await core.batchTasks(project, items))
      }

      case 'start_task': {
        const { project, title, async: later, ...fields } = args as { project: string; title: string; async?: boolean; [k: string]: unknown }
        if (later) {
          const id = core.previewStart(project, title)
          inBackground('start_task', core.startTask(project, title, fields))
          return json({ queued: true, id, status: 'in-progress' })
        }
        return json(await core.startTask(project, title, fields))
      }

      case 'list_docs': {
        const { query, limit, offset, fields, format, ...rest } = args as Parameters<typeof core.listDocs>[0] & { query?: string } & ListArgs
        const q = query?.trim().toLowerCase()
        const docs = core.listDocsWithBody(rest).filter(d => !q || d.title.toLowerCase().includes(q) || d.body.toLowerCase().includes(q))
        return text(listResult(docs.map(d => docRow(d)), { limit, offset, fields, format }, DOC_FIELDS, DOC_LIST_FIELDS))
      }

      case 'get_doc': {
        const { project, slug, maxChars, offset } = args as { project?: string; slug: string; maxChars?: number; offset?: number }
        return json(shapeDoc(core.getDoc(slug, project), { maxChars, offset }))
      }

      case 'upsert_doc':
        return json(await core.upsertDoc(args as Parameters<typeof core.upsertDoc>[0]))

      default:
        throw new Error(`Unknown tool: ${name}`)
    }
  }
  catch (err: any) {
    return {
      content: [{ type: 'text' as const, text: `Error: ${err.message}` }],
      isError: true,
    }
  }
}

const transport = new StdioServerTransport()
await server.connect(transport)
