<script setup lang="ts">
const route = useRoute()
const slug = computed(() => route.params.slug as string)

interface ProjectHeader { slug: string; path: string; title: string; icon?: string; status: string; description?: string; tags?: string[]; githubRepo?: string }

const project = inject<Ref<ProjectHeader>>('project')!

import type { DocTreeItem } from '~/components/DocTreeList.vue'

const { data: docs, refresh: refreshDocs, pending: docsPending } = await useAsyncData(
  () => `docs-${slug.value}`,
  () => $fetch<DocTreeItem[]>(`/api/docs/${slug.value}`),
)

const { createDoc } = useDocs()
const creating = ref(false)

async function createBlankDoc() {
  creating.value = true
  try {
    const { slug: docSlug } = await createDoc(slug.value, { title: 'Untitled' })
    await navigateTo({ path: `/projects/${slug.value}/docs/${docSlug}`, query: { new: '1' } })
  }
  finally {
    creating.value = false
  }
}

useHead(() => ({ title: `${project.value?.title ?? slug.value} — Docs` }))

const projectsMeta = resolveRouteMeta('/projects')
const breadcrumb = computed(() => [
  { label: projectsMeta.label ?? 'Projects', to: '/projects', icon: projectsMeta.icon },
  { label: project.value?.title ?? slug.value, icon: (project.value as any)?.icon || undefined },
])

const tabs = computed(() => [
  { label: 'Tasks', icon: 'i-lucide-list-checks', to: `/projects/${slug.value}/tasks` },
  { label: 'Docs', icon: DOC_ICON, to: `/projects/${slug.value}/docs` },
])

const mobileActions = [
  { label: 'New Doc', icon: 'i-lucide-plus', onSelect: createBlankDoc },
]
</script>

<template>
  <AppPageBase :breadcrumb="breadcrumb" :tabs="tabs" :mobile-actions="mobileActions">
    <template #actions>
      <UButton
        label="New Doc"
        icon="i-lucide-plus"
        size="sm"
        :loading="creating"
        @click="createBlankDoc"
      />
    </template>

    <div class="flex flex-col h-full space-y-3">
      <ProjectMetaBar :project="project" class="shrink-0" />

      <div class="flex flex-col flex-1 min-h-0" :class="docsPending ? 'opacity-50 pointer-events-none' : 'transition-opacity'">
        <div v-if="!docs?.length" class="flex flex-col items-center justify-center py-16 text-center gap-3">
          <UIcon :name="DOC_ICON" class="size-10 text-muted" />
          <p class="text-muted text-sm">No docs yet for this project.</p>
          <UButton label="Create first doc" icon="i-lucide-plus" size="sm" :loading="creating" @click="createBlankDoc" />
        </div>
        <DocList
          v-else
          :docs="docs"
          :base-url="`/projects/${slug}/docs`"
          :project-slug="slug"
          @changed="refreshDocs"
        />
      </div>
    </div>
  </AppPageBase>
</template>
