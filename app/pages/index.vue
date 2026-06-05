<script setup lang="ts">
definePageMeta({ title: 'Dashboard', icon: 'i-lucide-layout-dashboard' })

const { projects, tasks, refreshAll } = await useProjectTasks({ projects: 'dash-projects', tasks: 'dash-tasks' })

const showCreateProject = ref(false)

const stats = computed(() => {
  const t = tasks.value ?? []
  return [
    {
      label: 'Projects',
      value: projects.value?.length ?? 0,
      icon: 'i-lucide-folder',
      color: 'primary',
      statusId: null as string | null,
    },
    ...STATUS_CONFIG.map(s => ({
      label: s.label,
      value: t.filter(x => x.status === s.id).length,
      icon: s.icon,
      color: s.color,
      statusId: s.id,
    })),
  ]
})

const activeStatusId = ref<string | null>(null)

const presetStatuses = computed(() => {
  if (!activeStatusId.value) return []
  const s = STATUS_SELECT_ITEMS.find(x => x.value === activeStatusId.value)
  return s ? [s] : []
})

function handleStatClick(stat: typeof stats.value[0]) {
  if (!stat.statusId) {
    navigateTo('/projects')
    return
  }
  activeStatusId.value = activeStatusId.value === stat.statusId ? null : stat.statusId
}

</script>

<template>
  <AppPageBase
    title="Dashboard"
    icon="i-lucide-layout-dashboard"
    :empty="!(projects?.length ?? 0)"
    :empty-state="{
      icon: 'i-lucide-folder-plus',
      title: 'No projects yet',
      description: 'Create your first project to get started.',
      actions: [
        {
          label: 'New Project',
          icon: 'i-lucide-plus',
          onClick: () => showCreateProject = true,
        }
      ],
    }"
  >
    <div class="p-4 sm:p-6 space-y-6">
      <!-- Stats -->
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <button
          v-for="s in stats"
          :key="s.label"
          class="text-left"
          @click="handleStatClick(s)"
        >
          <UCard
            :ui="{ body: 'p-3!' }"
            class="h-full transition-all hover:ring-1"
            :class="(s.statusId && activeStatusId === s.statusId)
              ? `ring-1 ring-${s.color} hover:ring-${s.color}`
              : 'hover:ring-primary'"
          >
            <div class="flex items-center gap-3">
              <UIcon
                :name="s.icon"
                class="size-7 shrink-0"
                :class="`text-${s.color}`"
              />
              <div class="min-w-0">
                <p class="text-xl font-bold tabular-nums">
                  {{ s.value }}
                </p>
                <p class="text-xs text-muted truncate">
                  {{ s.label }}
                </p>
              </div>
            </div>
          </UCard>
        </button>
      </div>

      <!-- Tasks -->
      <div>
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-xs font-semibold text-muted uppercase tracking-widest">
            Tasks
          </h2>
          <NuxtLink
            to="/tasks"
            class="text-xs text-muted hover:text-primary"
          >
            View all →
          </NuxtLink>
        </div>
        <AppTaskList
          :tasks="((tasks ?? []) as any[])"
          :projects="((projects ?? []) as any[])"
          :preset-statuses="((presetStatuses ?? []) as any[])"
          @refresh="refreshAll"
        />
      </div>
    </div>
    <template #overlays>
      <ProjectForm
        v-if="showCreateProject"
        @close="showCreateProject = false"
        @saved="() => { showCreateProject = false; refreshAll() }"
      />
    </template>
  </AppPageBase>
</template>
