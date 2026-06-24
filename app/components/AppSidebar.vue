<script setup lang="ts">
import { useLocalStorage } from '@vueuse/core'

const isCollapsed = useLocalStorage('sidebar:collapsed', false)

defineShortcuts({
  meta_b: () => { isCollapsed.value = !isCollapsed.value },
})

const { data: projects } = await useAsyncData('sidebar-projects', () =>
  $fetch('/api/projects').then((list: any) => [...list].sort((a: any, b: any) => a.title.localeCompare(b.title))),
)

const navigation = computed(() => [
  { label: 'Inbox', icon: 'i-lucide-inbox', to: '/inbox' },
  { label: 'Docs', icon: 'i-lucide-book-open', to: '/docs' },
  {
    label: 'Projects',
    icon: 'i-lucide-notebook',
    to: '/projects',
    ...(projects.value?.length
      ? {
          defaultOpen: true,
          children: projects.value.map(p => ({
            label: p.title,
            icon: (p as any).icon || 'i-lucide-folder',
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
  <UDashboardSidebar
    v-model:collapsed="isCollapsed"
    :collapsible="true"
    :ui="{
      root: 'bg-muted',
      header: 'border-b border-default',
      footer: ['border-t border-default', isCollapsed ? 'flex-col! items-center!' : ''],
    }"
  >
    <template #header="{ collapsed }">
      <AppSidebarHeader :is-collapsed="collapsed" />
    </template>

    <template #default="{ collapsed }">
      <UTooltip v-if="collapsed" text="Search" :content="{ side: 'right' }">
        <UButton
          icon="i-lucide-search"
          color="neutral"
          variant="outline"
          size="sm"
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
          <div class="ms-auto me-0 inline-flex gap-x-1">
            <UKbd>⌘</UKbd>
            <UKbd>K</UKbd>
          </div>
        </template>
      </UButton>
      <hr class="border-default" />
      <UNavigationMenu
        :items="navigation"
        :collapsed="collapsed"
        orientation="vertical"
        :tooltip="{ side: 'right' }"
        :popover="{ side: 'right' }"
      />
    </template>

    <template #footer="{ collapsed }">
      <AppSidebarFooter :collapsed="collapsed" />
    </template>
  </UDashboardSidebar>
</template>
