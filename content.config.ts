import { defineContentConfig, defineCollection, z } from '@nuxt/content'

export default defineContentConfig({
  collections: {
    authors: defineCollection({
      type: 'page',
      source: 'authors/*.md',
      schema: z.object({
        name: z.string(),
        createdAt: z.string(),
      }),
    }),
    projects: defineCollection({
      type: 'page',
      source: 'projects/*/index.md',
      schema: z.object({
        title: z.string(),
        status: z.enum(['active', 'archived', 'on-hold']).default('active'),
        icon: z.string().optional(),
        tags: z.array(z.string()).default([]),
        description: z.string().optional(),
        createdAt: z.string(),
        updatedAt: z.string().optional(),
      }),
    }),
    tasks: defineCollection({
      type: 'page',
      source: 'projects/*/tasks/*.md',
      schema: z.object({
        title: z.string(),
        status: z.enum(['todo', 'in-progress', 'in-review', 'done', 'blocked']).default('todo'),
        priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
        tags: z.array(z.string()).default([]),
        assignees: z.array(z.string()).default([]),
        due: z.string().optional(),
        dependencies: z.array(z.string()).default([]),
        createdAt: z.string(),
        updatedAt: z.string().optional(),
        order: z.number().default(0),
      }),
    }),
  },
})
