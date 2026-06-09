<script setup lang="ts">
definePageMeta({ title: 'Docs', icon: 'i-lucide-book-open' })

import type { DocTreeItem } from '~/components/DocTreeList.vue'
import type { DocGroup } from '~/components/DocList.vue'

interface AllDoc extends DocTreeItem {
  project: string | null
}

interface ProjectHeader { slug: string; title: string; icon?: string; status: string }

const [{ data: allDocs, pending, refresh: refreshDocs }, { data: projects }] = await Promise.all([
  useAsyncData('all-docs', () => $fetch<AllDoc[]>('/api/docs')),
  useAsyncData('all-projects', () => $fetch<ProjectHeader[]>('/api/projects')),
])

const showCreate = ref(false)

async function onDocCreated(slug: string) {
  showCreate.value = false
  await navigateTo(`/docs/${slug}`)
}

const hasAnyDocs = computed(() => !!allDocs.value?.length)

const groups = computed((): DocGroup[] => {
  if (!allDocs.value?.length) return []

  const standalone = allDocs.value.filter(d => d.project === null)
  const projectMap = new Map<string, AllDoc[]>()
  for (const doc of allDocs.value.filter(d => d.project !== null)) {
    const arr = projectMap.get(doc.project!) ?? []
    arr.push(doc)
    projectMap.set(doc.project!, arr)
  }

  const result: DocGroup[] = []

  if (standalone.length) {
    result.push({ label: 'General', icon: 'i-lucide-book-open', docs: standalone, baseUrl: '/docs', projectSlug: null })
  }

  for (const [slug, docs] of projectMap) {
    const project = projects.value?.find(p => p.slug === slug)
    result.push({
      label: project?.title ?? slug,
      icon: project?.icon || 'i-lucide-folder',
      docs,
      baseUrl: `/projects/${slug}/docs`,
      projectSlug: slug,
    })
  }

  return result
})
</script>

<template>
  <AppPageBase
    title="Docs"
    icon="i-lucide-book-open"
    :actions="hasAnyDocs ? [{ label: 'New Doc', icon: 'i-lucide-plus', onSelect: () => showCreate = true }] : []"
    :empty="!hasAnyDocs"
    :empty-state="{
      icon: 'i-lucide-book-open',
      title: 'No docs yet',
      description: 'Create your first standalone doc.',
      actions: [{ label: 'New Doc', icon: 'i-lucide-plus', onClick: () => showCreate = true }],
    }"
  >
    <div class="flex flex-col flex-1 min-h-0" :class="pending ? 'opacity-50 pointer-events-none' : 'transition-opacity'">
      <DocList
        v-if="hasAnyDocs"
        :groups="groups"
        @changed="refreshDocs"
      />
    </div>

    <template #overlays>
      <DocForm
        v-if="showCreate"
        @close="showCreate = false"
        @saved="onDocCreated"
      />
    </template>
  </AppPageBase>
</template>
