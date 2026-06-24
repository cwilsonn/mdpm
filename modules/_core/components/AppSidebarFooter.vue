<script setup lang="ts">
defineProps<{ collapsed?: boolean }>()

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

const exportMenuItems = [
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

const colorMode = useColorMode()

function toggleColorMode() {
  colorMode.preference = colorMode.value === 'dark' ? 'light' : 'dark'
}

const colorModeIcon = computed(() =>
  colorMode.value === 'dark' ? 'i-lucide-moon' : 'i-lucide-sun',
)
</script>

<template>
  <template v-if="!collapsed">
    <UDropdownMenu
      :items="exportMenuItems"
      :ui="{ content: 'max-w-72 lg:max-w-120', itemDescription: 'whitespace-normal text-muted' }"
    >
      <UButton
        label="Export"
        icon="i-lucide-download"
        color="neutral"
        variant="ghost"
        size="sm"
      />
    </UDropdownMenu>
    <UButton
      :icon="colorModeIcon"
      color="neutral"
      variant="ghost"
      size="sm"
      class="ms-auto shrink-0"
      @click="toggleColorMode"
    />
  </template>
  <template v-else>
    <UTooltip text="Export" :content="{ side: 'right' }">
      <UDropdownMenu
        :items="exportMenuItems"
        :ui="{ content: 'max-w-72 lg:max-w-120', itemDescription: 'whitespace-normal text-muted' }"
      >
        <UButton
          icon="i-lucide-download"
          color="neutral"
          variant="ghost"
          size="sm"
        />
      </UDropdownMenu>
    </UTooltip>
    <UTooltip text="Color mode" :content="{ side: 'right' }">
      <UButton
        :icon="colorModeIcon"
        color="neutral"
        variant="ghost"
        size="sm"
        @click="toggleColorMode"
      />
    </UTooltip>
  </template>
</template>
