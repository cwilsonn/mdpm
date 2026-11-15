// The task status and priority vocabularies: the writer validates against them, and
// the MCP tool schemas and the project API derive their lists from them.
export const TASK_STATUSES = ['todo', 'in-progress', 'in-review', 'done', 'blocked', 'on-hold'] as const
export const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const
