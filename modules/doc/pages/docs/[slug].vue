<script setup lang="ts">
const route = useRoute()
const slug = computed(() => route.params.slug as string)

interface DocDetail {
  slug: string
  project: null
  title: string
  tags: string[]
  parent: string | null
  createdAt: string
  updatedAt?: string
  body: string
}

const { data: docMeta } = await useAsyncData(
  () => `standalone-doc-${slug.value}`,
  () => $fetch<DocDetail>(`/api/standalone-docs/${slug.value}`),
)

if (!docMeta.value) {
  throw createError({ statusCode: 404, message: 'Doc not found' })
}

const docsMeta = resolveRouteMeta('/docs')
const breadcrumb = computed(() => [
  { label: docsMeta.label ?? 'Docs', to: '/docs', icon: docsMeta.icon },
  { label: docMeta.value?.title || slug.value },
])
</script>

<template>
  <DocEditor
    :key="slug"
    :save-url="`/api/standalone-docs/${slug}`"
    :delete-url="`/api/standalone-docs/${slug}`"
    after-delete="/docs"
    :initial-title="docMeta!.title"
    :initial-tags="docMeta!.tags ?? []"
    :initial-body="docMeta!.body ?? ''"
    :fallback-title="slug"
    :breadcrumb="breadcrumb"
    back-to="/docs"
    :autofocus-title="route.query.new === '1'"
  />
</template>
