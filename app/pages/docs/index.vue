<script setup lang="ts">
definePageMeta({ title: 'Docs', icon: 'i-lucide-book-open' })

import type { DocTreeItem } from '~/components/DocTreeList.vue'

const { data: docs, refresh, pending } = await useAsyncData(
  'standalone-docs',
  () => $fetch<DocTreeItem[]>('/api/standalone-docs'),
)

const showCreate = ref(false)

async function onDocCreated(slug: string) {
  showCreate.value = false
  await navigateTo(`/docs/${slug}`)
}
</script>

<template>
  <AppPageBase
    title="Docs"
    icon="i-lucide-book-open"
    :actions="docs?.length ? [{ label: 'New Doc', icon: 'i-lucide-plus', onSelect: () => showCreate = true }] : []"
    :empty="!docs?.length"
    :empty-state="{
      icon: 'i-lucide-book-open',
      title: 'No docs yet',
      description: 'Create your first standalone doc.',
      actions: [{ label: 'New Doc', icon: 'i-lucide-plus', onClick: () => showCreate = true }],
    }"
  >
    <div class="flex flex-col flex-1 min-h-0" :class="pending ? 'opacity-50 pointer-events-none' : 'transition-opacity'">
      <DocList
        v-if="docs?.length"
        :docs="docs"
        base-url="/docs"
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
