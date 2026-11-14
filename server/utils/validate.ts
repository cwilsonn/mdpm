import type { ZodType, ZodTypeDef } from 'zod'
import { formatIssues } from '../../lib/core/write-schemas'

// A validator for h3's readValidatedBody / getValidatedQuery that answers 400 with a readable
// message (the default "Validation Error" tells the CLI user nothing).
export function validator<T>(schema: ZodType<T, ZodTypeDef, unknown>) {
  return (data: unknown): T => {
    const result = schema.safeParse(data)
    if (result.success) return result.data
    throw createError({ statusCode: 400, message: `Invalid request: ${formatIssues(result.error.issues)}` })
  }
}
