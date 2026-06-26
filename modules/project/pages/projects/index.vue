<script setup lang="ts">
import { VueDraggable } from 'vue-draggable-plus'

definePageMeta({ title: 'Projects', icon: 'i-lucide-notebook' })

const [{ data: projects, refresh, pending: projectsPending }, { data: allTasks }, { data: allDocs }] = await Promise.all([
  useAsyncData('projects-list', () => $fetch('/api/projects')),
  useAsyncData('projects-task-counts', () => $fetch('/api/tasks')),
  useAsyncData('projects-doc-counts', () => $fetch('/api/docs')),
])

const mounted = ref(false)
onMounted(() => { mounted.value = true })

const showCreate = ref(false)
type ProjectItem = NonNullable<typeof projects.value>[0]
const editingProject = ref<ProjectItem | null>(null)
const deletingProject = ref<{ slug: string; title: string } | null>(null)
const deletingProjectDisplay = ref<{ slug: string; title: string } | null>(null)
watch(deletingProject, val => { if (val) deletingProjectDisplay.value = val })
const deleteLoading = ref(false)

const projectSlug = slugFromPath

// Pinned / unpinned split — VueDraggable needs mutable refs
const pinnedProjects = ref<ProjectItem[]>([])
const unpinnedProjects = ref<ProjectItem[]>([])

watch(projects, (val) => {
  pinnedProjects.value = (val ?? []).filter(p => p.pinned)
  unpinnedProjects.value = (val ?? []).filter(p => !p.pinned)
}, { immediate: true })

async function saveOrder() {
  await $fetch('/api/projects/reorder', {
    method: 'POST',
    body: {
      pinned: pinnedProjects.value.map(p => projectSlug(p.path)!),
      unpinned: unpinnedProjects.value.map(p => projectSlug(p.path)!),
    },
  })
}

function togglePin(project: ProjectItem) {
  if (project.pinned) {
    pinnedProjects.value = pinnedProjects.value.filter(p => p.path !== project.path)
    unpinnedProjects.value = [{ ...project, pinned: false }, ...unpinnedProjects.value]
  }
  else {
    unpinnedProjects.value = unpinnedProjects.value.filter(p => p.path !== project.path)
    pinnedProjects.value = [...pinnedProjects.value, { ...project, pinned: true }]
  }
  saveOrder()
}

// Card stats
const today = new Date().toISOString().split('T')[0]!

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

const overdueCounts = computed(() => {
  const counts: Record<string, number> = {}
  for (const t of allTasks.value ?? []) {
    if (t.status === 'done' || !t.due || t.due >= today) continue
    const pSlug = t.path.split('/')[2]
    if (!pSlug) continue
    counts[pSlug] = (counts[pSlug] ?? 0) + 1
  }
  return counts
})

const docCountsByProject = computed(() => {
  const counts: Record<string, number> = {}
  for (const d of allDocs.value ?? []) {
    if (!d.project) continue
    counts[d.project] = (counts[d.project] ?? 0) + 1
  }
  return counts
})

const deletingProjectTaskCounts = computed(() => {
  if (!deletingProjectDisplay.value) return null
  return taskCountsByProject.value[deletingProjectDisplay.value.slug] ?? null
})

function cardActions(project: ProjectItem) {
  return [[
    {
      label: 'Edit',
      icon: 'i-lucide-pencil',
      onSelect: () => { editingProject.value = project },
    },
    {
      label: project.pinned ? 'Unpin' : 'Pin',
      icon: 'i-lucide-pin',
      onSelect: () => togglePin(project),
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
    <div class="overflow-y-auto flex-1 min-h-0" :class="projectsPending ? 'opacity-50 pointer-events-none' : 'transition-opacity'">
      <!-- Pinned section -->
      <div v-if="pinnedProjects.length && mounted" class="mb-6">
        <p class="text-xs font-medium text-muted uppercase tracking-wide mb-3 flex items-center gap-1.5">
          <UIcon name="i-lucide-pin" class="size-3.5" />
          Pinned
        </p>
        <VueDraggable
          v-model="pinnedProjects"
          :group="{ name: 'projects', pull: true, put: true }"
          :animation="150"
          ghost-class="opacity-40"
          class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 items-stretch"
          @end="saveOrder"
          @add="saveOrder"
        >
          <div
            v-for="project in pinnedProjects"
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
                      <h3 class="font-semibold truncate">{{ project.title }}</h3>
                      <UButton
                        icon="i-lucide-pin"
                        color="primary"
                        variant="soft"
                        size="sm"
                        class="shrink-0"
                        :tooltip="{ text: 'Unpin' }"
                        @click.prevent="togglePin(project)"
                      />
                    </div>
                    <div class="flex items-center gap-1 shrink-0">
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

                  <p v-if="project.description" class="text-sm text-muted line-clamp-2">
                    {{ project.description }}
                  </p>

                  <div class="mt-auto flex flex-col gap-3">
                    <div v-if="project.tags?.length" class="flex flex-wrap gap-1">
                      <UBadge
                        v-for="tag in project.tags"
                        :key="tag"
                        :label="tag"
                        color="neutral"
                        variant="outline"
                        size="sm"
                      />
                    </div>
                    <ProjectCardStats
                      :project-slug="projectSlug(project.path)!"
                      :task-counts="taskCountsByProject[projectSlug(project.path)!]"
                      :overdue-count="overdueCounts[projectSlug(project.path)!] ?? 0"
                      :doc-count="docCountsByProject[projectSlug(project.path)!] ?? 0"
                      :created-at="project.createdAt"
                      :github-repo="(project as any).githubRepo"
                    />
                  </div>
                </div>
              </UCard>
            </NuxtLink>
          </div>
          <div
            v-if="!pinnedProjects.length"
            class="col-span-full flex items-center justify-center py-4 text-xs text-muted italic"
          >
            Drag a project here to pin it
          </div>
        </VueDraggable>
      </div>

      <!-- All projects section -->
      <div v-if="unpinnedProjects.length && mounted">
        <USeparator v-if="pinnedProjects.length" class="mb-6" />
        <VueDraggable
          v-model="unpinnedProjects"
          :group="{ name: 'projects', pull: true, put: true }"
          :animation="150"
          ghost-class="opacity-40"
          class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 items-stretch"
          @end="saveOrder"
          @add="saveOrder"
        >
          <div
            v-for="project in unpinnedProjects"
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
                      <h3 class="font-semibold truncate">{{ project.title }}</h3>
                      <UButton
                        icon="i-lucide-pin"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        class="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                        :tooltip="{ text: 'Pin' }"
                        @click.prevent="togglePin(project)"
                      />
                    </div>
                    <div class="flex items-center gap-1 shrink-0">
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

                  <p v-if="project.description" class="text-sm text-muted line-clamp-2">
                    {{ project.description }}
                  </p>

                  <div class="mt-auto flex flex-col gap-3">
                    <div v-if="project.tags?.length" class="flex flex-wrap gap-1">
                      <UBadge
                        v-for="tag in project.tags"
                        :key="tag"
                        :label="tag"
                        color="neutral"
                        variant="outline"
                        size="sm"
                      />
                    </div>
                    <ProjectCardStats
                      :project-slug="projectSlug(project.path)!"
                      :task-counts="taskCountsByProject[projectSlug(project.path)!]"
                      :overdue-count="overdueCounts[projectSlug(project.path)!] ?? 0"
                      :doc-count="docCountsByProject[projectSlug(project.path)!] ?? 0"
                      :created-at="project.createdAt"
                      :github-repo="(project as any).githubRepo"
                    />
                  </div>
                </div>
              </UCard>
            </NuxtLink>
          </div>
        </VueDraggable>
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
          ? `'${deletingProjectDisplay?.title}' and ${deletingProjectTaskCounts.total} task${deletingProjectTaskCounts.total !== 1 ? 's' : ''} will be permanently deleted.`
          : `'${deletingProjectDisplay?.title}' will be permanently deleted.`"
        confirm-label="Delete"
        :loading="deleteLoading"
        @update:open="deletingProject = null"
        @confirm="executeDelete"
        @cancel="deletingProject = null"
      >
        <div v-if="deletingProjectTaskCounts?.total" class="space-y-1.5">
          <p class="text-xs font-medium text-muted uppercase tracking-wide">Tasks</p>
          <div class="rounded-md border border-default bg-muted/40 divide-y divide-default text-sm">
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
        </div>
      </AppConfirmDialog>
    </template>
  </AppPageBase>
</template>
