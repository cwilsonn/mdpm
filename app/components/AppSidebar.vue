<script setup lang="ts">
const { data: projects } = await useAsyncData('sidebar-projects', () =>
  queryCollection('projects').select('path', 'title', 'icon').order('title', 'ASC').all(),
)

const navigation = computed(() => [
  { label: 'Inbox', icon: 'i-lucide-inbox', to: '/inbox' },
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

const colorMode = useColorMode()

function toggleColorMode() {
  colorMode.preference = colorMode.value === 'dark' ? 'light' : 'dark'
}

const colorModeIcon = computed(() =>
  colorMode.value === 'dark' ? 'i-lucide-moon' : 'i-lucide-sun',
)

const { callHook } = useNuxtApp()
function openSearch() {
  callHook('dashboard:search:toggle' as any)
}

async function triggerDownload(path: string, fallbackName: string) {
  const res = await fetch(path)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const disposition = res.headers.get('Content-Disposition') ?? ''
  const match = disposition.match(/filename="([^"]+)"/)
  a.href = url
  a.download = match?.[1] ?? fallbackName
  a.click()
  URL.revokeObjectURL(url)
}

const exportItems = [
  [
    {
      label: 'As archive',
      icon: 'i-lucide-archive',
      description: 'Exports the full content directory as-is. Useful if you ever expect to re-import your data.',
      onSelect: () => triggerDownload('/api/export/archive', 'mdpm-content.zip'),
    },
    {
      label: 'Single-file',
      icon: 'i-lucide-file-text',
      description: 'Exports a single .md file with all projects and tasks inline. Great for when you need to migrate.',
      onSelect: () => triggerDownload('/api/export/markdown', 'mdpm-export.md'),
    },
  ],
]
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
        to="/projects"
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
      <UButton
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
      <UNavigationMenu
        :items="navigation"
        :collapsed="false"
        orientation="vertical"
      />
    </template>

    <template #footer>
      <UDropdownMenu
        :items="exportItems"
        :ui="{ content: 'max-w-72 lg:max-w-120', itemDescription: 'whitespace-normal text-muted' }"
      >
        <UButton
          label="Export"
          icon="i-lucide-download"
          trailing-icon="i-lucide-chevron-up"
          color="neutral"
          variant="ghost"
          size="sm"
          block
        />
      </UDropdownMenu>
    </template>
  </UDashboardSidebar>
</template>
