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

// The icon is chosen in CSS (the `dark` class), not from colorMode.value: the server can't know the mode, so a
// computed icon renders a sun on the server and a moon in a dark browser, a hydration mismatch. The color-mode
// script sets the class before the page renders, so the right icon shows from the first paint.
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
      color="neutral"
      variant="ghost"
      size="sm"
      square
      class="ms-auto shrink-0"
      aria-label="Toggle color mode"
      @click="toggleColorMode"
    >
      <UIcon name="i-lucide-sun" class="size-4 shrink-0 dark:hidden" />
      <UIcon name="i-lucide-moon" class="size-4 shrink-0 hidden dark:block" />
    </UButton>
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
        color="neutral"
        variant="ghost"
        size="sm"
        square
        aria-label="Toggle color mode"
        @click="toggleColorMode"
      >
        <UIcon name="i-lucide-sun" class="size-4 shrink-0 dark:hidden" />
        <UIcon name="i-lucide-moon" class="size-4 shrink-0 hidden dark:block" />
      </UButton>
    </UTooltip>
  </template>
</template>
