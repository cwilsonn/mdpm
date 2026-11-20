<script setup lang="ts">
defineProps<{ collapsed: boolean }>()

const { data: projects } = await useAsyncData('sidebar-projects', () =>
  $fetch<Project[]>('/api/projects').then(list => [...list].sort((a, b) => a.title.localeCompare(b.title))),
)

// aria-label repeats the label: collapsed, the menu renders icon-only links whose label is only a tooltip.
const navigation = computed(() => [
  { label: 'Inbox', 'aria-label': 'Inbox', icon: 'i-lucide-inbox', to: '/inbox' },
  { label: 'Docs', 'aria-label': 'Docs', icon: 'i-lucide-book-open', to: '/docs' },
  {
    label: 'Projects',
    'aria-label': 'Projects',
    icon: 'i-lucide-notebook',
    to: '/projects',
    ...(projects.value?.length
      ? {
          defaultOpen: true,
          children: projects.value.map(p => ({
            label: p.title,
            'aria-label': p.title,
            icon: p.icon || 'i-lucide-folder',
            to: `/projects/${slugFromPath(p.path)}`,
          })),
        }
      : {}),
  },
])

const { callHook } = useNuxtApp()

function openSearch() {
  callHook('dashboard:search:toggle' as any)
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <UTooltip v-if="collapsed" text="Search" :content="{ side: 'right' }">
      <UButton
        icon="i-lucide-search"
        color="neutral"
        variant="outline"
        size="sm"
        aria-label="Search"
        @click="openSearch"
      />
    </UTooltip>
    <UButton
      v-else
      label="Search"
      icon="i-lucide-search"
      color="neutral"
      variant="outline"
      size="sm"
      @click="openSearch"
    >
      <template #trailing>
        <div class="ms-auto me-0 inline-flex gap-x-1" aria-hidden="true">
          <UKbd :ui="{ base: 'p-0!' }">⌘</UKbd>
          <UKbd :ui="{ base: 'p-0!' }">K</UKbd>
        </div>
      </template>
    </UButton>
    <hr class="border-default" />
    <UNavigationMenu
      aria-label="Main"
      :items="navigation"
      :collapsed="collapsed"
      orientation="vertical"
      tooltip
      popover
    />
  </div>
</template>
