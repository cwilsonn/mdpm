<script setup lang="ts">
const { data: projects } = await useAsyncData('sidebar-projects', () =>
  queryCollection('projects').select('path', 'title').order('title', 'ASC').all(),
)

const navigation = computed(() => [
  { label: 'Dashboard', icon: 'i-lucide-layout-dashboard', to: '/' },
  { label: 'Tasks', icon: 'i-lucide-list-checks', to: '/tasks' },
  {
    label: 'Projects',
    icon: 'i-lucide-folder',
    to: '/projects',
    ...(projects.value?.length
      ? {
          children: projects.value.map(p => ({
            label: p.title,
            icon: 'i-lucide-folder-open',
            to: `/projects/${p.path.split('/').at(-1)}`,
          })),
        }
      : {}),
  },
])

const colorMode = useColorMode()

function toggleColorMode() {
  colorMode.preference = colorMode.value === 'dark' ? 'light' : 'dark'
}

const colorModeIcon = computed(() =>
  colorMode.value === 'dark' ? 'i-lucide-moon' : 'i-lucide-sun',
)
</script>

<template>
  <UDashboardSidebar
    collapsible
    :ui="{
      root: 'bg-muted',
      header: 'border-b border-default',
      footer: 'border-t border-default',
    }"
  >
    <template #header>
      <NuxtLink
        to="/"
        class="flex items-center gap-2 px-1"
      >
        <UIcon
          name="i-lucide-square-check-big"
          class="size-6 shrink-0 text-primary"
        />
        <span class="text-lg font-bold font-mono truncate">.mdpm</span>
      </NuxtLink>
      <UButton
        :icon="colorModeIcon"
        color="neutral"
        variant="ghost"
        size="sm"
        :ui="{ base: 'ms-auto me-0' }"
        @click="toggleColorMode"
      />
    </template>

    <template #default>
      <UNavigationMenu
        :items="navigation"
        orientation="vertical"
      />
    </template>
  </UDashboardSidebar>
</template>
