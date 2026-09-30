import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { createCore, createLifecycle, loadConfig } from '../lib/core'

const loaded = loadConfig()
// Opt-in (MDPM_AUTO_START=1 or `autoStart` in the config file): a write that finds the server down
// starts it and retries. Unlike the CLI, this long-lived process never stops it again.
const lifecycle = createLifecycle(loaded.config)
const core = createCore(loaded.config, loaded.autoStart.value ? { onUnreachable: async () => { await lifecycle.start() } } : {})

// ─── Server ──────────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'mdpm', version: '1.0.0' },
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
          githubIssue: { type: 'number', description: 'Return only tasks linked to this GitHub issue number.' },
          githubPR: { type: 'number', description: 'Return only tasks linked to this GitHub PR number.' },
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
          githubIssues: { type: 'array', items: { type: 'number' }, description: 'Linked GitHub issue numbers.' },
          githubPRs: { type: 'array', items: { type: 'number' }, description: 'Linked GitHub PR numbers.' },
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
          githubIssues: { type: 'array', items: { type: 'number' }, description: 'Linked GitHub issue numbers.' },
          githubPRs: { type: 'array', items: { type: 'number' }, description: 'Linked GitHub PR numbers.' },
          description: { type: 'string', description: 'Markdown body' },
        },
        required: ['project', 'slug'],
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
      description: 'Create a new project. Use when tracking a new repo/effort in mdpm for the first time; pass githubRepo to link the repo. Follow up with the onboard skill to scaffold architecture/context docs.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          icon: { type: 'string' },
          status: { type: 'string', description: 'Project status. Defaults to "active".' },
          tags: { type: 'array', items: { type: 'string' } },
          githubRepo: { type: 'string', description: 'GitHub repo, e.g. "owner/name".' },
          availableStatuses: { type: 'array', items: { type: 'string' } },
          defaultStatus: { type: 'string' },
          defaultPriority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
          defaultAssignee: { type: 'string' },
        },
        required: ['title'],
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
        }, true)
      }

      case 'list_projects':
        return json(core.listProjects(args as { includeArchived?: boolean }), true)

      case 'get_project':
        return json(core.getProject((args as { slug: string }).slug), true)

      case 'list_tasks':
        return json(core.listTasks(args as Parameters<typeof core.listTasks>[0]), true)

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
        const { project, slug, note } = args as { project: string; slug: string; note: string }
        return json(await core.appendTaskNote(project, slug, note))
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
