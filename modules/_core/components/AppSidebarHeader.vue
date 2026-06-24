<template>
  <NuxtLink
    to="/projects"
    class="flex items-center gap-2 px-1"
  >
    <UIcon
      name="i-lucide-square-check-big"
      class="size-6 shrink-0 text-primary"
    />
    <span v-if="!isCollapsed" class="text-lg font-bold font-mono truncate">.mdpm</span>
  </NuxtLink>
</template>

<script setup lang="ts">
defineProps<{
  isCollapsed: boolean
}>()
</script>
