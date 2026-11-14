import { z } from 'zod'
import { TASK_PRIORITIES, TASK_STATUSES } from './schema'

// What a write may contain. Request bodies are merged into frontmatter, so anything not named here
// is refused instead of being stored (that is how two real tasks got their text in a `body:` key).
// The Nitro routes validate with these through readValidatedBody; the plan is for the CLI and MCP to
// write through the same schemas once writes move into lib/core.

const slug = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'must be a slug (lowercase letters, digits, hyphens)')
const strings = z.array(z.string())
const PROJECT_STATUSES = ['active', 'on-hold'] as const

// Links are on their way out (see the audit decisions); until then their own validation lives in
// applyLinkWrite, so the schema only lets them through.
const legacyLinkFields = {
  links: z.unknown().optional(),
  githubIssues: z.array(z.number().int()).nullable().optional(),
  githubPRs: z.array(z.number().int()).nullable().optional(),
}

// Docs call the markdown `body`, tasks call it `description`. Accept either for tasks, not both.
function taskText<T extends z.ZodRawShape>(shape: T) {
  return z.preprocess((input) => {
    if (!input || typeof input !== 'object' || Array.isArray(input) || !('body' in input)) return input
    const { body, ...rest } = input as Record<string, unknown>
    if (rest.description !== undefined) return { ...rest, body }
    return { ...rest, description: body }
  }, z.object(shape).strict())
}

const noteFields = {
  note: z.string().optional(),
  noteAuthor: z.string().optional(),
}

export const TaskCreate = taskText({
  project: slug,
  title: z.string().trim().min(1, 'is required'),
  slug: slug.optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  tags: strings.optional(),
  assignees: strings.optional(),
  due: z.string().optional(),
  dependencies: strings.optional(),
  description: z.string().optional(),
  ...legacyLinkFields,
  ...noteFields,
})

// `null` clears an optional field (the server deletes the key).
export const TaskUpdate = taskText({
  title: z.string().trim().min(1, 'cannot be empty').optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  tags: strings.nullable().optional(),
  assignees: strings.nullable().optional(),
  due: z.string().nullable().optional(),
  dependencies: strings.nullable().optional(),
  description: z.string().optional(),
  order: z.number().optional(),
  archivedAt: z.string().nullable().optional(),
  ...legacyLinkFields,
  ...noteFields,
})

export const ProjectUpdate = z.object({
  title: z.string().trim().min(1, 'cannot be empty').optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  icon: z.string().nullable().optional(),
  description: z.string().optional(),
  tags: strings.nullable().optional(),
  githubRepo: z.string().nullable().optional(),
  links: z.unknown().optional(),
  availableStatuses: z.array(z.enum(TASK_STATUSES)).nullable().optional(),
  defaultStatus: z.enum(TASK_STATUSES).nullable().optional(),
  defaultPriority: z.enum(TASK_PRIORITIES).nullable().optional(),
  defaultAssignee: z.string().nullable().optional(),
  pinned: z.boolean().nullable().optional(),
  pinnedOrder: z.number().nullable().optional(),
  archivedAt: z.string().nullable().optional(),
}).strict()

export const DocUpdate = z.object({
  title: z.string().trim().min(1, 'cannot be empty').optional(),
  tags: strings.nullable().optional(),
  parent: slug.nullable().optional(),
  order: z.number().optional(),
  body: z.string().optional(),
  archivedAt: z.string().nullable().optional(),
  links: z.unknown().optional(),
}).strict()

// One line per problem, phrased for a person reading CLI output or a toast.
export function formatIssues(issues: z.ZodIssue[]): string {
  return issues.map((issue) => {
    if (issue.code === 'unrecognized_keys') {
      return `unknown field${issue.keys.length > 1 ? 's' : ''}: ${issue.keys.join(', ')}`
    }
    const at = issue.path.join('.')
    return at ? `${at}: ${issue.message}` : issue.message
  }).join('; ')
}
