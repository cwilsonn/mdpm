<script setup lang="ts">
definePageMeta({ title: 'Projects', icon: 'i-lucide-folder' })

const [{ data: projects, refresh }, { data: allTasks }] = await Promise.all([
  useAsyncData('projects-list', () => queryCollection('projects').order('createdAt', 'DESC').all()),
  useAsyncData('projects-task-counts', () => queryCollection('tasks').select('path', 'status').all()),
])

const showCreate = ref(false)

function projectSlug(path: string) {
  return path.split('/').at(-1)
}

const taskCountsByProject = computed(() => {
  const counts: Record<string, { total: number, done: number }> = {}
  for (const t of allTasks.value ?? []) {
    const pSlug = t.path.split('/')[2]
    if (!pSlug) continue
    if (!counts[pSlug]) counts[pSlug] = { total: 0, done: 0 }
    counts[pSlug].total++
    if (t.status === 'done') counts[pSlug].done++
  }
  return counts
})
</script>

<template>
  <AppPageBase
    title="Projects"
    icon="i-lucide-folder"
    :actions="[{ label: 'New Project', icon: 'i-lucide-plus', onSelect: () => showCreate = true }]"
    :empty="!projects?.length"
    :empty-state="{
      icon: 'i-lucide-folder-plus',
      title: 'No projects yet',
      description: 'Create your first project to get started.',
    }"
  >
    <div class="p-4 sm:p-6">
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <NuxtLink
          v-for="project in projects"
          :key="project.path"
          :to="`/projects/${projectSlug(project.path)}`"
          class="block group"
        >
          <UCard class="h-full group-hover:ring-1 group-hover:ring-primary transition-all" :ui="{ body: 'p-4' }">
            <div class="space-y-3">
              <div class="flex items-start justify-between gap-2">
                <h3 class="font-semibold truncate">
                  {{ project.title }}
                </h3>
                <UBadge
                  :label="project.status"
                  :color="PROJECT_STATUS_MAP[project.status]?.color ?? 'neutral'"
                  variant="subtle"
                  size="xs"
                  class="shrink-0"
                />
              </div>

              <p
                v-if="project.description"
                class="text-sm text-muted line-clamp-2"
              >
                {{ project.description }}
              </p>

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
                  size="xs"
                />
              </div>

              <div class="flex items-center justify-between gap-2">
                <p class="text-xs text-muted">
                  {{ project.createdAt }}
                </p>
                <span
                  v-if="taskCountsByProject[projectSlug(project.path) ?? '']"
                  class="text-xs text-muted shrink-0"
                >
                  {{ taskCountsByProject[projectSlug(project.path) ?? ''].done }}
                  /
                  {{ taskCountsByProject[projectSlug(project.path) ?? ''].total }}
                  done
                </span>
              </div>
            </div>
          </UCard>
        </NuxtLink>
      </div>
    </div>

    <template #overlays>
      <ProjectForm
        v-if="showCreate"
        @close="showCreate = false"
        @saved="() => { showCreate = false; refresh() }"
      />
    </template>
  </AppPageBase>
</template>
