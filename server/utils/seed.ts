import { existsSync, readdirSync, rmSync } from 'node:fs'

interface SeedTask {
  title: string
  status: string
  priority: string
  tags?: string[]
  description?: string
}

interface SeedProject {
  title: string
  slug: string
  status: string
  icon: string
  description: string
  tags: string[]
  tasks: SeedTask[]
}

const SEED_PROJECTS: SeedProject[] = [
  {
    title: 'Website Redesign',
    slug: 'website-redesign',
    status: 'active',
    icon: 'i-lucide-layout',
    description: 'Refresh the public marketing site with updated brand guidelines and improved performance.',
    tags: ['design', 'frontend'],
    tasks: [
      { title: 'Audit current site performance', status: 'done', priority: 'high', tags: ['research'] },
      { title: 'Design new homepage mockups', status: 'done', priority: 'high', tags: ['design'] },
      { title: 'Implement responsive nav', status: 'in-progress', priority: 'high' },
      { title: 'Migrate blog content', status: 'in-progress', priority: 'medium', tags: ['content'] },
      { title: 'Set up analytics', status: 'todo', priority: 'medium' },
      { title: 'Cross-browser QA pass', status: 'todo', priority: 'low', tags: ['qa'] },
    ],
  },
  {
    title: 'API v2',
    slug: 'api-v2',
    status: 'active',
    icon: 'i-lucide-server',
    description: 'Rebuild the public API with improved auth, rate limiting, and OpenAPI documentation.',
    tags: ['backend', 'api'],
    tasks: [
      { title: 'Define OpenAPI spec', status: 'done', priority: 'urgent', tags: ['docs'] },
      { title: 'Implement JWT refresh flow', status: 'done', priority: 'urgent' },
      { title: 'Add rate limiting middleware', status: 'in-review', priority: 'high' },
      { title: 'Write integration tests', status: 'in-progress', priority: 'high', tags: ['testing'] },
      { title: 'Generate SDK from spec', status: 'todo', priority: 'medium' },
      { title: 'Deprecation notices for v1', status: 'blocked', priority: 'low', description: 'Blocked on legal sign-off for deprecation timeline.' },
    ],
  },
  {
    title: 'Q3 Growth Sprint',
    slug: 'q3-growth-sprint',
    status: 'on-hold',
    icon: 'i-lucide-trending-up',
    description: 'Initiatives targeting a 20% increase in trial signups through onboarding and SEO improvements.',
    tags: ['growth', 'marketing'],
    tasks: [
      { title: 'A/B test new pricing page', status: 'done', priority: 'high' },
      { title: 'Improve trial onboarding flow', status: 'in-progress', priority: 'high', tags: ['product'] },
      { title: 'SEO audit and fixes', status: 'todo', priority: 'medium', tags: ['seo'] },
      { title: 'Set up referral program', status: 'todo', priority: 'low' },
    ],
  },
]

const SEED_AUTHOR = { name: 'Demo User', slug: 'demo-user' }

export function seedContent() {
  const today = new Date().toISOString().split('T')[0]!

  // Author
  if (!existsSync(contentPath('authors', `${SEED_AUTHOR.slug}.md`))) {
    writeMarkdown(`authors/${SEED_AUTHOR.slug}.md`, {
      name: SEED_AUTHOR.name,
      createdAt: today,
    })
  }

  for (const project of SEED_PROJECTS) {
    const projectPath = `projects/${project.slug}/index.md`
    if (!existsSync(contentPath('projects', project.slug, 'index.md'))) {
      writeMarkdown(projectPath, {
        title: project.title,
        status: project.status,
        icon: project.icon,
        description: project.description,
        tags: project.tags,
        createdAt: today,
      })
    }

    project.tasks.forEach((task, i) => {
      const tSlug = slugify(task.title)
      const taskPath = `projects/${project.slug}/tasks/${tSlug}.md`
      if (!existsSync(contentPath(taskPath))) {
        writeMarkdown(taskPath, {
          title: task.title,
          status: task.status,
          priority: task.priority,
          tags: task.tags ?? [],
          assignees: [SEED_AUTHOR.name],
          dependencies: [],
          createdAt: today,
          order: i,
        }, task.description ?? '')
      }
    })
  }
}

export function resetContent() {
  const projectsDir = contentPath('projects')
  const authorsDir = contentPath('authors')

  if (existsSync(projectsDir)) {
    for (const entry of readdirSync(projectsDir)) {
      if (entry === '.gitkeep') continue
      rmSync(contentPath('projects', entry), { recursive: true, force: true })
    }
  }

  if (existsSync(authorsDir)) {
    for (const entry of readdirSync(authorsDir)) {
      if (entry === '.gitkeep') continue
      rmSync(contentPath('authors', entry), { recursive: true, force: true })
    }
  }

  seedContent()
}
