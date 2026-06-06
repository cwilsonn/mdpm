import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import matter from 'gray-matter'

const CONTENT_PATH = process.env.MDPM_CONTENT_PATH
const BASE_URL = process.env.MDPM_BASE_URL ?? 'http://localhost:3000'

if (!CONTENT_PATH) {
  console.error('MDPM_CONTENT_PATH env var is required')
  process.exit(1)
}

function contentPath(...parts: string[]) {
  return join(CONTENT_PATH!, ...parts)
}

function readMd(relPath: string) {
  const full = contentPath(relPath)
  if (!existsSync(full)) return null
  return matter(readFileSync(full, 'utf-8'))
}

function listDirs(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name)
}

function listMdFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter(f => f.endsWith('.md'))
}

// ─── Read helpers ────────────────────────────────────────────────────────────

function getProjects() {
  const projectsDir = contentPath('projects')
  return listDirs(projectsDir).map((slug) => {
    const file = readMd(`projects/${slug}/index.md`)
    const tasksDir = contentPath('projects', slug, 'tasks')
    const taskCount = listMdFiles(tasksDir).length
    const docsDir = contentPath('projects', slug, 'docs')
    const docCount = listMdFiles(docsDir).length
    return {
      slug,
      title: (file?.data?.title as string) ?? slug,
      status: (file?.data?.status as string) ?? 'active',
      icon: (file?.data?.icon as string) ?? null,
      tags: (file?.data?.tags as string[]) ?? [],
      description: (file?.data?.description as string) ?? null,
      createdAt: (file?.data?.createdAt as string) ?? '',
      taskCount,
      docCount,
    }
  })
}

function getTasks(projectSlug: string, statusFilter?: string[]) {
  const tasksDir = contentPath('projects', projectSlug, 'tasks')
  return listMdFiles(tasksDir).flatMap((f) => {
    const slug = f.replace('.md', '')
    const file = readMd(`projects/${projectSlug}/tasks/${slug}.md`)
    if (!file) return []
    const status = (file.data.status as string) ?? 'todo'
    if (statusFilter?.length && !statusFilter.includes(status)) return []
    return [{
      slug,
      project: projectSlug,
      title: (file.data.title as string) ?? slug,
      status,
      priority: (file.data.priority as string) ?? 'medium',
      tags: (file.data.tags as string[]) ?? [],
      assignees: (file.data.assignees as string[]) ?? [],
      due: (file.data.due as string) ?? null,
      dependencies: (file.data.dependencies as string[]) ?? [],
      createdAt: (file.data.createdAt as string) ?? '',
      updatedAt: (file.data.updatedAt as string) ?? null,
      order: (file.data.order as number) ?? 0,
      body: file.content.trim(),
    }]
  }).sort((a, b) => a.order - b.order)
}

function getDocs(projectSlug?: string) {
  const projectSlugs = projectSlug ? [projectSlug] : listDirs(contentPath('projects'))
  return projectSlugs.flatMap((pSlug) => {
    const docsDir = contentPath('projects', pSlug, 'docs')
    return listMdFiles(docsDir).flatMap((f) => {
      const slug = f.replace('.md', '')
      const file = readMd(`projects/${pSlug}/docs/${slug}.md`)
      if (!file) return []
      return [{
        slug,
        project: pSlug,
        title: (file.data.title as string) ?? slug,
        tags: (file.data.tags as string[]) ?? [],
        createdAt: (file.data.createdAt as string) ?? '',
        updatedAt: (file.data.updatedAt as string) ?? null,
        excerpt: file.content.slice(0, 300).replace(/[#*`_]/g, '').trim(),
        body: file.content.trim(),
      }]
    })
  })
}

function searchDocs(query: string, projectSlug?: string) {
  const q = query.toLowerCase()
  return getDocs(projectSlug).filter(
    d => d.title.toLowerCase().includes(q) || d.body.toLowerCase().includes(q),
  ).map(d => ({
    slug: d.slug,
    project: d.project,
    title: d.title,
    tags: d.tags,
    updatedAt: d.updatedAt,
    excerpt: d.body
      .split('\n')
      .find(line => line.toLowerCase().includes(q))
      ?.trim()
      .slice(0, 200) ?? d.excerpt,
  }))
}

// ─── Write helpers (via HTTP API) ────────────────────────────────────────────

async function apiPost(path: string, body: unknown) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }))
    throw new Error((err as any).message ?? res.statusText)
  }
  return res.json()
}

async function apiPatch(path: string, body: unknown) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }))
    throw new Error((err as any).message ?? res.statusText)
  }
  return res.json()
}

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
      description: 'List all projects with metadata and counts.',
      inputSchema: { type: 'object', properties: {} },
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
      description: 'List tasks for a project, optionally filtered by status.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Project slug' },
          status: {
            type: 'array',
            items: { type: 'string', enum: ['todo', 'in-progress', 'in-review', 'done', 'blocked'] },
            description: 'Filter by status values. Omit for all.',
          },
        },
        required: ['project'],
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
          status: { type: 'string', enum: ['todo', 'in-progress', 'in-review', 'done', 'blocked'] },
          priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
          tags: { type: 'array', items: { type: 'string' } },
          assignees: { type: 'array', items: { type: 'string' } },
          due: { type: 'string', description: 'YYYY-MM-DD' },
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
          status: { type: 'string', enum: ['todo', 'in-progress', 'in-review', 'done', 'blocked'] },
          priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] },
          tags: { type: 'array', items: { type: 'string' } },
          assignees: { type: 'array', items: { type: 'string' } },
          due: { type: 'string' },
          description: { type: 'string', description: 'Markdown body' },
        },
        required: ['project', 'slug'],
      },
    },
    {
      name: 'list_docs',
      description: 'List docs, optionally filtered to a specific project.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'Project slug. Omit for all projects.' },
        },
      },
    },
    {
      name: 'get_doc',
      description: 'Get full content of a doc including markdown body.',
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
      name: 'search_docs',
      description: 'Full-text search across doc titles and bodies.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          project: { type: 'string', description: 'Scope to a project. Omit for all.' },
        },
        required: ['query'],
      },
    },
    {
      name: 'upsert_doc',
      description: 'Create or update a doc. If slug exists it will be updated; otherwise a new doc is created with a slug derived from the title.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string' },
          slug: { type: 'string', description: 'Existing slug to update. Omit to create new.' },
          title: { type: 'string' },
          body: { type: 'string', description: 'Full markdown body' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['project', 'title', 'body'],
      },
    },
  ],
}))

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params

  try {
    switch (name) {
      case 'ping': {
        const projects = getProjects()
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              ok: true,
              contentPath: CONTENT_PATH,
              baseUrl: BASE_URL,
              projectCount: projects.length,
              projects: projects.map(p => p.slug),
            }, null, 2),
          }],
        }
      }

      case 'list_projects': {
        return { content: [{ type: 'text', text: JSON.stringify(getProjects(), null, 2) }] }
      }

      case 'get_project': {
        const { slug } = args as { slug: string }
        const projects = getProjects()
        const project = projects.find(p => p.slug === slug)
        if (!project) throw new Error(`Project '${slug}' not found`)
        return { content: [{ type: 'text', text: JSON.stringify(project, null, 2) }] }
      }

      case 'list_tasks': {
        const { project, status } = args as { project: string; status?: string[] }
        const tasks = getTasks(project, status)
        return { content: [{ type: 'text', text: JSON.stringify(tasks, null, 2) }] }
      }

      case 'get_task': {
        const { project, slug } = args as { project: string; slug: string }
        const tasks = getTasks(project)
        const task = tasks.find(t => t.slug === slug)
        if (!task) throw new Error(`Task '${slug}' not found in project '${project}'`)
        return { content: [{ type: 'text', text: JSON.stringify(task, null, 2) }] }
      }

      case 'create_task': {
        const { project, ...rest } = args as { project: string; [k: string]: unknown }
        const result = await apiPost('/api/tasks', { project, ...rest })
        return { content: [{ type: 'text', text: JSON.stringify(result) }] }
      }

      case 'update_task': {
        const { project, slug, ...rest } = args as { project: string; slug: string; [k: string]: unknown }
        const result = await apiPatch(`/api/tasks/${project}/${slug}`, rest)
        return { content: [{ type: 'text', text: JSON.stringify(result) }] }
      }

      case 'list_docs': {
        const { project } = args as { project?: string }
        const docs = getDocs(project).map(({ body: _, ...d }) => d)
        return { content: [{ type: 'text', text: JSON.stringify(docs, null, 2) }] }
      }

      case 'get_doc': {
        const { project, slug } = args as { project: string; slug: string }
        const docs = getDocs(project)
        const doc = docs.find(d => d.slug === slug)
        if (!doc) throw new Error(`Doc '${slug}' not found in project '${project}'`)
        return { content: [{ type: 'text', text: JSON.stringify(doc, null, 2) }] }
      }

      case 'search_docs': {
        const { query, project } = args as { query: string; project?: string }
        const results = searchDocs(query, project)
        return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] }
      }

      case 'upsert_doc': {
        const { project, slug, title, body, tags } = args as {
          project: string
          slug?: string
          title: string
          body: string
          tags?: string[]
        }
        let result
        if (slug && existsSync(contentPath('projects', project, 'docs', `${slug}.md`))) {
          result = await apiPatch(`/api/docs/${project}/${slug}`, { title, body, tags })
          result.slug = slug
        }
        else {
          result = await apiPost(`/api/docs/${project}`, { title, body: body, tags })
        }
        return { content: [{ type: 'text', text: JSON.stringify(result) }] }
      }

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
