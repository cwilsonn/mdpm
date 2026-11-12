import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { buildPickup, createCore, createLifecycle, DEFAULT_LIMIT, DEFAULT_MAX_CHARS, DOC_FIELDS, DOC_LIST_FIELDS, docRow, KINDS, loadConfig, paginate, parseFields, parseLinkedFilter, pickFields, recordUsage, REPO_ROOT, schemaStatus, shapeDoc, shapeTask, TASK_FIELDS, TASK_LIST_FIELDS, taskRow, toTsv } from '../lib/core'
import type { BatchItem } from '../lib/core'

// Same source of truth as the CLI, so release-please keeps both in step.
const version: string = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).version

const loaded = loadConfig()
// Opt-in (MDPM_AUTO_START=1 or `autoStart` in the config file): a write that finds the server down
// starts it and retries. Unlike the CLI, this long-lived process never stops it again.
const lifecycle = createLifecycle(loaded.config)
// A stored link. Prefer add_link/remove_link, which resolve a pasted URL or short ref for you;
// passing `links` replaces the whole list, so read the item first (get_task returns its links).
const LINKS_PROP = {
  type: 'array',
  description: 'Replaces the item\'s whole list of links; to add or remove one, use add_link / remove_link instead.',
  items: {
    type: 'object',
    properties: {
      url: { type: 'string' },
      provider: { type: 'string', description: 'e.g. github, gitlab' },
      kind: { type: 'string', enum: [...KINDS] },
      ref: { type: 'string', description: 'Provider-canonical ref, e.g. "owner/repo#42"' },
      title: { type: 'string' },
    },
  },
} as const

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

const core = createCore(loaded.config, loaded.autoStart.value ? { onUnreachable: async () => { await lifecycle.start() } } : {})

// ─── Server ──────────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'mdpm', version },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'ping',
      description: 'Check that the mdpm MCP server is reachable and return basic stats.',
      inputSchema: { type: 'object', properties: {} },
    },
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
      description: `List tasks as a compact page (default ${DEFAULT_LIMIT} rows, summary columns only: no bodies). Optionally filtered by project, status, or link. Omit project for all projects. Archived tasks are excluded unless includeArchived is set. Use get_task for one task's body; fields ["summary"] adds a one-line digest.`,
      inputSchema: {
        type: 'object',
        properties: {
          ...LIST_PROPS,
          project: { type: 'string', description: 'Project slug. Omit for all projects.' },
          status: {
            type: 'array',
            items: { type: 'string', enum: ['todo', 'in-progress', 'in-review', 'done', 'blocked', 'on-hold'] },
            description: 'Filter by status values. Omit for all.',
          },
          linked: { type: 'string', description: 'Return only tasks with a link matching provider[:kind[:ref]], e.g. "github", "jira", "github:change", "gitlab:change:group/proj!9".' },
          githubIssue: { type: 'number', description: 'Deprecated: use linked ("github:issue"). Return only tasks linked to this GitHub issue number.' },
          githubPR: { type: 'number', description: 'Deprecated: use linked ("github:change"). Return only tasks linked to this GitHub PR number.' },
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
          project: { type: 'string' },
          title: { type: 'string' },
          status: { type: 'string', enum: ['todo', 'in-progress', 'in-review', 'done', 'blocked', 'on-hold'] },
          priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
          tags: { type: 'array', items: { type: 'string' } },
          assignees: { type: 'array', items: { type: 'string' } },
          due: { type: 'string', description: 'YYYY-MM-DD' },
          links: LINKS_PROP,
          githubIssues: { type: 'array', items: { type: 'number' }, description: 'Deprecated: use add_link. Linked GitHub issue numbers (replaces the list; converted to links).' },
          githubPRs: { type: 'array', items: { type: 'number' }, description: 'Deprecated: use add_link. Linked GitHub PR numbers (replaces the list; converted to links).' },
          description: { type: 'string', description: 'Markdown body' },
          note: { type: 'string', description: 'Appended as a timestamped note in the same write.' },
          noteAuthor: { type: 'string', description: 'Author of the note; defaults to $MDPM_AUTHOR, else "claude".' },
        },
        required: ['project', 'title'],
      },
    },
    {
      name: 'update_task',
      description: 'Update fields on an existing task.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string' },
          slug: { type: 'string' },
          title: { type: 'string' },
          status: { type: 'string', enum: ['todo', 'in-progress', 'in-review', 'done', 'blocked', 'on-hold'] },
          priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
          tags: { type: 'array', items: { type: 'string' } },
          assignees: { type: 'array', items: { type: 'string' } },
          due: { type: 'string' },
          links: LINKS_PROP,
          githubIssues: { type: 'array', items: { type: 'number' }, description: 'Deprecated: use add_link. Linked GitHub issue numbers (replaces the list; converted to links).' },
          githubPRs: { type: 'array', items: { type: 'number' }, description: 'Deprecated: use add_link. Linked GitHub PR numbers (replaces the list; converted to links).' },
          description: { type: 'string', description: 'Markdown body' },
          note: { type: 'string', description: 'Appended as a timestamped note in the same write (status + note in one call).' },
          noteAuthor: { type: 'string', description: 'Author of the note; defaults to $MDPM_AUTHOR, else "claude".' },
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
      name: 'add_link',
      description: 'Add a link to a task, project, or doc from a pasted URL or a short ref (#42, ABC-123). Short refs expand against the project\'s repo link; "#42" on GitHub could be an issue or a pull request, so pass kind. Duplicates are ignored. Returns the stored link and how it displays.',
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['task', 'project', 'doc'] },
          project: { type: 'string', description: 'Project slug. Required for a task; for a doc omit it to mean a standalone doc.' },
          slug: { type: 'string', description: 'Task or doc slug, or the project slug when type is project.' },
          input: { type: 'string', description: 'A URL, or a short ref such as "#42" or "ABC-123".' },
          provider: { type: 'string', description: 'Provider id (github, gitlab, ...) when the input could be several.' },
          kind: { type: 'string', enum: [...KINDS], description: 'Which kind of link when ambiguous, e.g. "change" for a pull/merge request.' },
          title: { type: 'string', description: 'Label to show instead of the derived one.' },
        },
        required: ['type', 'slug', 'input'],
      },
    },
    {
      name: 'remove_link',
      description: 'Remove a link from a task, project, or doc. Name it by @N (position in the item\'s links), URL, ref, label, or title; an ambiguous name is an error.',
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['task', 'project', 'doc'] },
          project: { type: 'string', description: 'Project slug. Required for a task; omit for a standalone doc.' },
          slug: { type: 'string' },
          link: { type: 'string', description: '@N, URL, ref, label (e.g. "#42"), or title.' },
        },
        required: ['type', 'slug', 'link'],
      },
    },
    {
      name: 'resolve_link',
      description: 'Show how a URL or short ref would be understood (provider, kind, canonical URL, label) without writing anything.',
      inputSchema: {
        type: 'object',
        properties: {
          input: { type: 'string' },
          project: { type: 'string', description: 'Project whose repo link expands short refs.' },
          provider: { type: 'string' },
          kind: { type: 'string', enum: [...KINDS] },
          title: { type: 'string' },
        },
        required: ['input'],
      },
    },
    {
      name: 'list_docs',
      description: `List docs as a compact page (default ${DEFAULT_LIMIT} rows, no bodies; fields ["summary"] adds a one-line digest). Pass project to scope to a project. Omit both for all docs including standalone. Archived docs (and children of archived folders) are excluded unless includeArchived is set.`,
      inputSchema: {
        type: 'object',
        properties: {
          ...LIST_PROPS,
          project: { type: 'string', description: 'Project slug. Omit for all docs (project + standalone).' },
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
      name: 'search_docs',
      description: 'Full-text search across doc titles and bodies.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          project: { type: 'string', description: 'Scope to a project. Omit for all (including standalone).' },
        },
        required: ['query'],
      },
    },
    {
      name: 'create_project',
      description: 'Create a new project. Use when tracking a new repo/effort in mdpm for the first time; pass links (or add_link afterwards) to link the repo. Follow up with the onboard skill to scaffold architecture/context docs.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          icon: { type: 'string' },
          status: { type: 'string', description: 'Project status. Defaults to "active".' },
          tags: { type: 'array', items: { type: 'string' } },
          links: LINKS_PROP,
          githubRepo: { type: 'string', description: 'Deprecated: use add_link (a repo URL). GitHub repo, e.g. "owner/name".' },
          availableStatuses: { type: 'array', items: { type: 'string' } },
          defaultStatus: { type: 'string' },
          defaultPriority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
          defaultAssignee: { type: 'string' },
        },
        required: ['title'],
      },
    },
    {
      name: 'update_project',
      description: 'Update fields on an existing project. Pass null for icon, githubRepo, defaultStatus, defaultPriority, or defaultAssignee to clear them.',
      inputSchema: {
        type: 'object',
        properties: {
          slug: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          icon: { type: ['string', 'null'] },
          status: { type: 'string', description: 'Project status, e.g. "active" or "on-hold".' },
          tags: { type: 'array', items: { type: 'string' } },
          links: LINKS_PROP,
          githubRepo: { type: ['string', 'null'], description: 'Deprecated: use add_link/remove_link. GitHub repo, e.g. "owner/name".' },
          availableStatuses: { type: 'array', items: { type: 'string' } },
          defaultStatus: { type: ['string', 'null'] },
          defaultPriority: { type: ['string', 'null'], enum: ['low', 'medium', 'high', 'urgent', null] },
          defaultAssignee: { type: ['string', 'null'] },
        },
        required: ['slug'],
      },
    },
    {
      name: 'archive_project',
      description: 'Archive a project (hidden from list_projects unless includeArchived is set). Reversible with unarchive_project.',
      inputSchema: {
        type: 'object',
        properties: { slug: { type: 'string' } },
        required: ['slug'],
      },
    },
    {
      name: 'unarchive_project',
      description: 'Restore an archived project.',
      inputSchema: {
        type: 'object',
        properties: { slug: { type: 'string' } },
        required: ['slug'],
      },
    },
    {
      name: 'delete_project',
      description: 'Permanently delete a project and ALL of its tasks and docs. Irreversible; prefer archive_project unless the user explicitly asked to delete.',
      inputSchema: {
        type: 'object',
        properties: { slug: { type: 'string' } },
        required: ['slug'],
      },
    },
    {
      name: 'archive_task',
      description: 'Archive a task (hidden from list_tasks unless includeArchived is set). Reversible with unarchive_task.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string' },
          slug: { type: 'string' },
        },
        required: ['project', 'slug'],
      },
    },
    {
      name: 'unarchive_task',
      description: 'Restore an archived task.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string' },
          slug: { type: 'string' },
        },
        required: ['project', 'slug'],
      },
    },
    {
      name: 'archive_doc',
      description: 'Archive a doc (hidden from list_docs unless includeArchived is set). Reversible with unarchive_doc.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Project slug. Omit for a standalone doc.' },
          slug: { type: 'string' },
        },
        required: ['slug'],
      },
    },
    {
      name: 'unarchive_doc',
      description: 'Restore an archived doc.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Project slug. Omit for a standalone doc.' },
          slug: { type: 'string' },
        },
        required: ['slug'],
      },
    },
    {
      name: 'delete_task',
      description: 'Permanently delete a task.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string' },
          slug: { type: 'string' },
        },
        required: ['project', 'slug'],
      },
    },
    {
      name: 'delete_doc',
      description: 'Permanently delete a doc.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string' },
          slug: { type: 'string' },
        },
        required: ['project', 'slug'],
      },
    },
    {
      name: 'search_tasks',
      description: 'Full-text search across task titles and bodies, optionally scoped to a project. Returns a compact page with a `match` column (the first matching line), not bodies.',
      inputSchema: {
        type: 'object',
        properties: {
          ...LIST_PROPS,
          query: { type: 'string' },
          project: { type: 'string', description: 'Scope to a project. Omit for all projects.' },
          status: {
            type: 'array',
            items: { type: 'string', enum: ['todo', 'in-progress', 'in-review', 'done', 'blocked', 'on-hold'] },
            description: 'Filter by status values.',
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'append_task_note',
      description: 'Append a timestamped note to a task description without overwriting existing content.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string' },
          slug: { type: 'string' },
          note: { type: 'string', description: 'Markdown note to append' },
          author: { type: 'string', description: 'Who is writing the note. Defaults to $MDPM_AUTHOR, else "claude".' },
        },
        required: ['project', 'slug', 'note'],
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
      case 'ping': {
        const projects = core.listProjects({ includeArchived: true })
        return json({
          ok: true,
          contentPath: core.config.contentPath,
          baseUrl: core.config.baseUrl,
          projectCount: projects.length,
          projects: projects.map(p => p.slug),
          pendingMigration: schemaStatus(core.config.contentPath).pendingFiles,
        }, true)
      }

      case 'pickup': {
        const { project, delta, full } = args as { project: string; delta?: boolean; full?: boolean }
        const p = buildPickup(core, core.resolveProject(project).slug, { full })
        return json(delta ? { project: p.project, sinceLastSession: p.sinceLastSession, blockers: p.blockers } : p)
      }

      case 'list_projects':
        return json(core.listProjects(args as { includeArchived?: boolean }), true)

      case 'get_project':
        return json(core.getProject((args as { slug: string }).slug), true)

      case 'list_tasks': {
        const { linked, limit, offset, fields, format, ...rest } = args as Parameters<typeof core.listTasks>[0] & { linked?: string } & ListArgs
        const tasks = core.listTasks({ ...rest, ...(linked && { linked: parseLinkedFilter(linked) }) })
        return text(listResult(tasks.map(t => taskRow(t)), { limit, offset, fields, format }, TASK_FIELDS, TASK_LIST_FIELDS))
      }

      case 'add_link': {
        const { type, project, slug, input, provider, kind, title } = args as { type: 'task' | 'project' | 'doc'; project?: string; slug: string; input: string; provider?: string; kind?: (typeof KINDS)[number]; title?: string }
        return json(await core.addLinkTo(core.linkTarget(type, { project, slug }), input, { provider, kind, title }))
      }

      case 'remove_link': {
        const { type, project, slug, link } = args as { type: 'task' | 'project' | 'doc'; project?: string; slug: string; link: string }
        return json(await core.removeLinkFrom(core.linkTarget(type, { project, slug }), link))
      }

      case 'resolve_link': {
        const { input, project, provider, kind, title } = args as { input: string; project?: string; provider?: string; kind?: (typeof KINDS)[number]; title?: string }
        return json(core.resolveLinkInput(input, { project, provider, kind, title }), true)
      }

      case 'get_task': {
        const { project, slug, full, notes } = args as { project: string; slug: string; full?: boolean; notes?: number }
        return json(shapeTask(core.getTask(project, slug), { full, notes }))
      }

      case 'create_task': {
        const { project, ...rest } = args as { project: string; [k: string]: unknown }
        return json(await core.createTask(project, withNoteAuthor(rest)))
      }

      case 'update_task': {
        const { project, slug, ...rest } = args as { project: string; slug: string; [k: string]: unknown }
        return json(await core.updateTask(project, slug, withNoteAuthor(rest)))
      }

      case 'batch_tasks': {
        const { project, ops } = args as { project?: string; ops: BatchItem[] }
        const author = process.env.MDPM_AUTHOR || 'claude'
        return json(await core.batchTasks(project, ops.map(o => (o.op === 'note' || (o as { note?: string }).note) ? { ...o, author: (o as { author?: string }).author?.trim() || author } as BatchItem : o)))
      }

      case 'start_task': {
        const { project, title, ...fields } = args as { project: string; title: string; [k: string]: unknown }
        return json(await core.startTask(project, title, fields))
      }

      case 'create_project':
        return json(await core.createProject(args))

      case 'update_project': {
        const { slug, ...fields } = args as { slug: string } & Record<string, unknown>
        return json(await core.updateProject(slug, fields))
      }

      case 'archive_project':
      case 'unarchive_project': {
        const { slug } = args as { slug: string }
        return json(await core.archiveProject(slug, name === 'archive_project'))
      }

      case 'delete_project': {
        const { slug } = args as { slug: string }
        return json(await core.deleteProject(slug))
      }

      case 'archive_task':
      case 'unarchive_task': {
        const { project, slug } = args as { project: string; slug: string }
        return json(await core.archiveTask(project, slug, name === 'archive_task'))
      }

      case 'archive_doc':
      case 'unarchive_doc': {
        const { project, slug } = args as { project?: string; slug: string }
        return json(await core.archiveDoc({ project, slug }, name === 'archive_doc'))
      }

      case 'delete_task': {
        const { project, slug } = args as { project: string; slug: string }
        return json(await core.deleteTask(project, slug))
      }

      case 'delete_doc': {
        const { project, slug } = args as { project: string; slug: string }
        return json(await core.deleteDoc(project, slug))
      }

      case 'search_tasks': {
        const { query, project, status, limit, offset, fields, format } = args as unknown as { query: string; project?: string; status?: string[] } & ListArgs
        return text(listResult(core.searchTasks(query, project, status).map(t => taskRow(t, query)), { limit, offset, fields, format }, TASK_FIELDS, ['project', 'slug', 'title', 'status', 'priority', 'match']))
      }

      case 'append_task_note': {
        const { project, slug, note, author } = args as { project: string; slug: string; note: string; author?: string }
        return json(await core.appendTaskNote(project, slug, note, author?.trim() || process.env.MDPM_AUTHOR || 'claude'))
      }

      case 'list_docs': {
        const { limit, offset, fields, format, ...rest } = args as Parameters<typeof core.listDocs>[0] & ListArgs
        return text(listResult(core.listDocsWithBody(rest).map(d => docRow(d)), { limit, offset, fields, format }, DOC_FIELDS, DOC_LIST_FIELDS))
      }

      case 'get_doc': {
        const { project, slug, maxChars, offset } = args as { project?: string; slug: string; maxChars?: number; offset?: number }
        return json(shapeDoc(core.getDoc(slug, project), { maxChars, offset }))
      }

      case 'search_docs': {
        const { query, project } = args as { query: string; project?: string }
        return json(core.searchDocs(query, project), true)
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
