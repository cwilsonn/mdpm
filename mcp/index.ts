import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { createCore, createLifecycle, KINDS, loadConfig, parseLinkedFilter, REPO_ROOT, schemaStatus } from '../lib/core'

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
      description: 'List tasks, optionally filtered by project, status, or linked GitHub issue/PR number. Omit project for all projects. Archived tasks are excluded unless includeArchived is set.',
      inputSchema: {
        type: 'object',
        properties: {
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
      description: 'Get full details and description body for a single task.',
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
        },
        required: ['project', 'slug'],
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
      description: 'List docs. Pass project to scope to a project. Omit both for all docs including standalone. Archived docs (and children of archived folders) are excluded unless includeArchived is set.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Project slug. Omit for all docs (project + standalone).' },
          standalone: { type: 'boolean', description: 'Set true to list only standalone (non-project) docs.' },
          includeArchived: { type: 'boolean', description: 'Include archived docs and descendants of archived folders. Defaults to false.' },
        },
      },
    },
    {
      name: 'get_doc',
      description: 'Get full content of a doc including markdown body. Omit project for a standalone doc.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Project slug. Omit for standalone doc.' },
          slug: { type: 'string' },
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
      description: 'Full-text search across task titles and description bodies, optionally scoped to a project.',
      inputSchema: {
        type: 'object',
        properties: {
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

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params
  const json = (value: unknown, pretty = false) => ({
    content: [{ type: 'text', text: JSON.stringify(value, null, pretty ? 2 : undefined) }],
  })

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

      case 'list_projects':
        return json(core.listProjects(args as { includeArchived?: boolean }), true)

      case 'get_project':
        return json(core.getProject((args as { slug: string }).slug), true)

      case 'list_tasks': {
        const { linked, ...rest } = args as Parameters<typeof core.listTasks>[0] & { linked?: string }
        return json(core.listTasks({ ...rest, ...(linked && { linked: parseLinkedFilter(linked) }) }), true)
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
        const { project, slug } = args as { project: string; slug: string }
        return json(core.getTask(project, slug), true)
      }

      case 'create_task': {
        const { project, ...rest } = args as { project: string; [k: string]: unknown }
        return json(await core.createTask(project, rest))
      }

      case 'update_task': {
        const { project, slug, ...rest } = args as { project: string; slug: string; [k: string]: unknown }
        return json(await core.updateTask(project, slug, rest))
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
        const { query, project, status } = args as { query: string; project?: string; status?: string[] }
        return json(core.searchTasks(query, project, status), true)
      }

      case 'append_task_note': {
        const { project, slug, note, author } = args as { project: string; slug: string; note: string; author?: string }
        return json(await core.appendTaskNote(project, slug, note, author?.trim() || process.env.MDPM_AUTHOR || 'claude'))
      }

      case 'list_docs':
        return json(core.listDocs(args as Parameters<typeof core.listDocs>[0]), true)

      case 'get_doc': {
        const { project, slug } = args as { project?: string; slug: string }
        return json(core.getDoc(slug, project), true)
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
      content: [{ type: 'text', text: `Error: ${err.message}` }],
      isError: true,
    }
  }
})

const transport = new StdioServerTransport()
await server.connect(transport)
