<script setup lang="ts">
const route = useRoute()
const projectSlug = computed(() => route.params.slug as string)
const docSlug = computed(() => route.params.doc as string)

interface DocDetail {
  slug: string
  project: string
  title: string
  tags: string[]
  createdAt: string
  updatedAt?: string
  body: string
}

interface ProjectHeader { slug: string; path: string; title: string; icon?: string; status: string }

const project = inject<Ref<ProjectHeader>>('project')!

const { data: docMeta } = await useAsyncData(
  () => `doc-${projectSlug.value}-${docSlug.value}`,
  () => $fetch<DocDetail>(`/api/docs/${projectSlug.value}/${docSlug.value}`),
)

if (!docMeta.value) {
  throw createError({ statusCode: 404, message: 'Doc not found' })
}

const projectsMeta = resolveRouteMeta('/projects')
const breadcrumb = computed(() => [
  { label: projectsMeta.label ?? 'Projects', to: '/projects', icon: projectsMeta.icon },
  { label: project.value?.title ?? projectSlug.value, to: `/projects/${projectSlug.value}/docs`, icon: (project.value as any)?.icon || undefined },
  { label: docMeta.value?.title || docSlug.value },
])

const tabs = computed(() => [
  { label: 'Tasks', icon: 'i-lucide-list-checks', to: `/projects/${projectSlug.value}/tasks` },
  { label: 'Docs', icon: 'i-lucide-book-open', to: `/projects/${projectSlug.value}/docs`, active: true },
])
</script>

<template>
  <DocEditor
    :key="docSlug"
    :save-url="`/api/docs/${projectSlug}/${docSlug}`"
    :delete-url="`/api/docs/${projectSlug}/${docSlug}`"
    :after-delete="`/projects/${projectSlug}/docs`"
    :initial-title="docMeta!.title"
    :initial-tags="docMeta!.tags ?? []"
    :initial-body="docMeta!.body ?? ''"
    :fallback-title="docSlug"
    :breadcrumb="breadcrumb"
    :tabs="tabs"
    :autofocus-title="route.query.new === '1'"
  />
</template>
