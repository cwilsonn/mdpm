<script setup lang="ts">
import { useLocalStorage } from '@vueuse/core'

const isCollapsed = useLocalStorage('sidebar:collapsed', false)

defineShortcuts({
  meta_b: () => { isCollapsed.value = !isCollapsed.value },
})
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
      <AppSidebarMenu :collapsed="collapsed" />
    </template>

    <template #footer="{ collapsed }">
      <AppSidebarFooter :collapsed="collapsed" />
    </template>
  </UDashboardSidebar>
</template>
