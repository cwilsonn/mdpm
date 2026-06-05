<script setup lang="ts">
const route = useRoute()
useHead(() => ({
  title: route.meta.title as string | undefined,
}))
</script>

<template>
  <UDashboardGroup>
    <AppSidebar />
    <slot />
    <AppCommandPalette />
  </UDashboardGroup>
</template>
