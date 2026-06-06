<script setup lang="ts">
definePageMeta({ title: 'Projects', icon: 'i-lucide-folder' })

const [{ data: projects, refresh, pending: projectsPending }, { data: allTasks }] = await Promise.all([
  useAsyncData('projects-list', () => queryCollection('projects').order('createdAt', 'DESC').all()),
  useAsyncData('projects-task-counts', () => queryCollection('tasks').select('path', 'status').all()),
])

const showCreate = ref(false)
type ProjectItem = NonNullable<typeof projects.value>[0]
const editingProject = ref<ProjectItem | null>(null)
const deletingProject = ref<{ slug: string; title: string } | null>(null)
const deleteLoading = ref(false)

const projectSlug = slugFromPath

const taskCountsByProject = computed(() => {
  const counts: Record<string, { total: number, done: number, byStatus: Record<string, number> }> = {}
  for (const t of allTasks.value ?? []) {
    const pSlug = t.path.split('/')[2]
    if (!pSlug) continue
    if (!counts[pSlug]) counts[pSlug] = { total: 0, done: 0, byStatus: {} }
    counts[pSlug].total++
    if (t.status === 'done') counts[pSlug].done++
    const sId = t.status ?? 'todo'
    counts[pSlug].byStatus[sId] = (counts[pSlug].byStatus[sId] ?? 0) + 1
  }
  return counts
})

const deletingProjectTaskCounts = computed(() => {
  if (!deletingProject.value) return null
  return taskCountsByProject.value[deletingProject.value.slug] ?? null
})

function cardActions(project: NonNullable<typeof projects.value>[0]) {
  return [[
    {
      label: 'Edit',
      icon: 'i-lucide-pencil',
      onSelect: () => { editingProject.value = project },
    },
    {
      label: 'Delete',
      icon: 'i-lucide-trash-2',
      color: 'error' as const,
      onSelect: () => {
        deletingProject.value = { slug: projectSlug(project.path)!, title: project.title }
      },
    },
  ]]
}

async function executeDelete() {
  if (!deletingProject.value) return
  deleteLoading.value = true
  try {
    await $fetch(`/api/projects/${deletingProject.value.slug}`, { method: 'DELETE' })
    deletingProject.value = null
    await refresh()
  }
  finally {
    deleteLoading.value = false
  }
}
</script>

<template>
  <AppPageBase
    title="Projects"
    icon="i-lucide-folder"
    :actions="projects?.length ? [{ label: 'New Project', icon: 'i-lucide-plus', onSelect: () => showCreate = true }] : []"
    :empty="!projects?.length"
    :empty-state="{
      icon: 'i-lucide-folder-plus',
      title: 'No projects yet',
      description: 'Create your first project to get started.',
      actions: [
        {
          label: 'New Project',
          icon: 'i-lucide-plus',
          onClick: () => showCreate = true,
        }
      ],
    }"
  >
    <div>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 items-stretch" :class="projectsPending ? 'opacity-50 pointer-events-none' : 'transition-opacity'">
        <div
          v-for="project in projects"
          :key="project.path"
          class="group relative h-full"
        >
          <NuxtLink
            :to="`/projects/${projectSlug(project.path)}`"
            class="block h-full"
          >
            <UCard class="h-full group-hover:ring-1 group-hover:ring-primary transition-all" :ui="{ body: 'p-4! h-full' }">
              <div class="flex flex-col h-full gap-3">
                <div class="flex items-start justify-between gap-2">
                  <div class="flex items-center gap-2 min-w-0">
                    <UIcon
                      :name="project.icon || 'i-lucide-folder'"
                      class="size-4 shrink-0 text-primary"
                    />
                    <h3 class="font-semibold truncate">
                      {{ project.title }}
                    </h3>
                  </div>
                  <div class="flex items-center gap-1.5 shrink-0">
                    <UBadge
                      :label="project.status"
                      :color="PROJECT_STATUS_MAP[project.status ?? 'active']?.color ?? 'neutral'"
                      variant="subtle"
                      size="sm"
                    />
                    <UDropdownMenu :items="cardActions(project)">
                      <UButton
                        icon="i-lucide-ellipsis-vertical"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        @click.prevent
                      />
                    </UDropdownMenu>
                  </div>
                </div>

                <p
                  v-if="project.description"
                  class="text-sm text-muted line-clamp-2"
                >
                  {{ project.description }}
                </p>

                <div class="mt-auto flex flex-col gap-3">
                  <div
                    v-if="project.tags?.length"
                    class="flex flex-wrap gap-1"
                  >
                    <UBadge
                      v-for="tag in project.tags"
                      :key="tag"
                      :label="tag"
                      color="neutral"
                      variant="outline"
                      size="sm"
                    />
                  </div>

                <div class="flex items-center justify-between gap-2">
                  <p class="text-xs text-muted">
                    {{ project.createdAt }}
                  </p>
                  <span
                    v-if="projectSlug(project.path) && taskCountsByProject[projectSlug(project.path)!]"
                    class="text-xs text-muted shrink-0"
                  >
                    {{ taskCountsByProject[projectSlug(project.path)!]!.done }}
                    /
                    {{ taskCountsByProject[projectSlug(project.path)!]!.total }}
                    done
                  </span>
                </div>
                </div>
              </div>
            </UCard>
          </NuxtLink>
        </div>
      </div>
    </div>

    <template #overlays>
      <ProjectForm
        v-if="showCreate"
        @close="showCreate = false"
        @saved="() => { showCreate = false; refresh() }"
      />
      <ProjectForm
        v-if="editingProject"
        :project="editingProject"
        @close="editingProject = null"
        @saved="() => { editingProject = null; refresh() }"
      />
      <AppConfirmDialog
        :open="!!deletingProject"
        title="Delete project?"
        :message="deletingProjectTaskCounts?.total
          ? `'${deletingProject?.title}' and ${deletingProjectTaskCounts.total} task${deletingProjectTaskCounts.total !== 1 ? 's' : ''} will be permanently deleted.`
          : `'${deletingProject?.title}' will be permanently deleted.`"
        confirm-label="Delete"
        :loading="deleteLoading"
        @update:open="deletingProject = null"
        @confirm="executeDelete"
        @cancel="deletingProject = null"
      >
        <div
          v-if="deletingProjectTaskCounts?.total"
          class="rounded-md border border-default bg-muted/40 divide-y divide-default text-sm"
        >
          <div
            v-for="s in STATUS_CONFIG.filter(s => deletingProjectTaskCounts!.byStatus[s.id])"
            :key="s.id"
            class="flex items-center justify-between px-3 py-1.5"
          >
            <div class="flex items-center gap-1.5">
              <UIcon :name="s.icon" :class="`text-${s.color}`" class="size-3.5 shrink-0" />
              <span class="text-muted">{{ s.label }}</span>
            </div>
            <span class="font-medium tabular-nums">{{ deletingProjectTaskCounts!.byStatus[s.id] }}</span>
          </div>
        </div>
      </AppConfirmDialog>
    </template>
  </AppPageBase>
</template>
