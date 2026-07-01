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

const { createDoc } = useDocs()
const creating = ref(false)

async function createBlankDoc() {
  creating.value = true
  try {
    const { slug } = await createDoc(undefined, { title: 'Untitled' })
    await navigateTo({ path: `/docs/${slug}`, query: { new: '1' } })
  }
  finally {
    creating.value = false
  }
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
    result.push({ label: 'General', icon: DOC_ICON, docs: standalone, baseUrl: '/docs', projectSlug: null })
  }

  for (const [slug, docs] of projectMap) {
    const project = projects.value?.find(p => p.slug === slug)
    result.push({
      label: project?.title ?? slug,
      icon: project?.icon || DOC_FOLDER_ICON,
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
    :icon="DOC_ICON"
    :actions="hasAnyDocs ? [{ label: 'New Doc', icon: 'i-lucide-plus', loading: creating, onSelect: createBlankDoc }] : []"
    :empty="!hasAnyDocs"
    :empty-state="{
      icon: DOC_ICON,
      title: 'No docs yet',
      description: 'Create your first standalone doc.',
      actions: [{ label: 'New Doc', icon: 'i-lucide-plus', onClick: createBlankDoc }],
    }"
  >
    <div class="flex flex-col flex-1 min-h-0" :class="pending ? 'opacity-50 pointer-events-none' : 'transition-opacity'">
      <DocList
        v-if="hasAnyDocs"
        :groups="groups"
        @changed="refreshDocs"
      />
    </div>
  </AppPageBase>
</template>
