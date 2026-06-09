<script setup lang="ts">
const route = useRoute()
const slug = computed(() => route.params.slug as string)

interface ProjectHeader { slug: string; path: string; title: string; icon?: string; status: string }

const { data: project } = await useAsyncData(
  () => `project-${slug.value}`,
  () => $fetch<ProjectHeader>(`/api/projects/${slug.value}`).catch(() => null),
)

if (!project.value) {
  throw createError({ statusCode: 404, message: 'Project not found' })
}

import type { DocTreeItem } from '~/components/DocTreeList.vue'

const { data: docs, refresh: refreshDocs, pending: docsPending } = await useAsyncData(
  () => `docs-${slug.value}`,
  () => $fetch<DocTreeItem[]>(`/api/docs/${slug.value}`),
)

const showCreateDoc = ref(false)

async function onDocCreated(docSlug: string) {
  showCreateDoc.value = false
  await navigateTo(`/projects/${slug.value}/docs/${docSlug}`)
}

useHead(() => ({ title: `${project.value?.title ?? slug.value} — Docs` }))

const projectsMeta = resolveRouteMeta('/projects')
const breadcrumb = computed(() => [
  { label: projectsMeta.label ?? 'Projects', to: '/projects', icon: projectsMeta.icon },
  { label: project.value?.title ?? slug.value, icon: (project.value as any)?.icon || undefined },
])

const tabs = computed(() => [
  { label: 'Tasks', icon: 'i-lucide-list-checks', to: `/projects/${slug.value}`, exact: true },
  { label: 'Docs', icon: 'i-lucide-book-open', to: `/projects/${slug.value}/docs` },
])

const mobileActions = [
  { label: 'New Doc', icon: 'i-lucide-plus', onSelect: () => { showCreateDoc.value = true } },
]
</script>

<template>
  <AppPageBase :breadcrumb="breadcrumb" :tabs="tabs" :mobile-actions="mobileActions">
    <template #actions>
      <UButton
        label="New Doc"
        icon="i-lucide-plus"
        size="sm"
        @click="showCreateDoc = true"
      />
    </template>

    <div class="overflow-y-auto flex-1 min-h-0" :class="docsPending ? 'opacity-50 pointer-events-none' : 'transition-opacity'">
      <div v-if="!docs?.length" class="flex flex-col items-center justify-center py-16 text-center gap-3">
        <UIcon name="i-lucide-book-open" class="size-10 text-muted" />
        <p class="text-muted text-sm">No docs yet for this project.</p>
        <UButton label="Create first doc" icon="i-lucide-plus" size="sm" @click="showCreateDoc = true" />
      </div>
      <DocTreeList
        v-else
        :docs="docs"
        :base-url="`/projects/${slug}/docs`"
      />
    </div>

    <template #overlays>
      <DocForm
        v-if="showCreateDoc"
        :project-slug="slug"
        @close="showCreateDoc = false"
        @saved="onDocCreated"
      />
    </template>
  </AppPageBase>
</template>
