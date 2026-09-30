// Nitro auto-imports `createError` in server code. The CLI tsconfig type-checks server/utils/content.ts
// (imported by tests), so declare the one global it needs.
declare function createError(input: { statusCode?: number; message?: string }): Error
