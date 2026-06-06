<script setup lang="ts">
definePageMeta({ title: 'Docs', icon: 'i-lucide-book-open' })

interface Doc {
  slug: string
  project: string
  title: string
  tags: string[]
  createdAt: string
  updatedAt?: string
  excerpt: string
}

const { data: projects } = await useAsyncData('docs-projects', () =>
  queryCollection('projects').select('path', 'title', 'icon').all(),
)

const { data: docs, refresh } = await useAsyncData('docs-all', () =>
  $fetch<Doc[]>('/api/docs'),
)

const search = ref('')
const filterProjects = ref<{ label: string; value: string }[]>([])
const filterTags = ref<{ label: string; value: string }[]>([])
const sortBy = ref<'updatedAt' | 'createdAt' | 'title'>('updatedAt')

const projectSelectItems = computed(() =>
  (projects.value ?? []).map(p => ({ label: p.title, value: slugFromPath(p.path) })),
)

const allTags = computed(() => {
  const set = new Set<string>()
  for (const d of docs.value ?? []) d.tags.forEach(t => set.add(t))
  return [...set].sort().map(t => ({ label: t, value: t }))
})

const SORT_ITEMS = [
  { label: 'Last updated', value: 'updatedAt' },
  { label: 'Created', value: 'createdAt' },
  { label: 'Title', value: 'title' },
]

const filtered = computed(() => {
  let list = docs.value ?? []
  const q = search.value.trim().toLowerCase()
  if (q) list = list.filter(d => d.title.toLowerCase().includes(q) || d.excerpt.toLowerCase().includes(q))
  if (filterProjects.value.length) list = list.filter(d => filterProjects.value.some(p => p.value === d.project))
  if (filterTags.value.length) list = list.filter(d => filterTags.value.some(t => d.tags.includes(t.value)))
  return [...list].sort((a, b) => {
    if (sortBy.value === 'title') return a.title.localeCompare(b.title)
    const aDate = (sortBy.value === 'updatedAt' ? a.updatedAt ?? a.createdAt : a.createdAt)
    const bDate = (sortBy.value === 'updatedAt' ? b.updatedAt ?? b.createdAt : b.createdAt)
    return bDate.localeCompare(aDate)
  })
})

const hasActiveFilter = computed(() =>
  !!search.value || filterProjects.value.length > 0 || filterTags.value.length > 0,
)

function clearFilters() {
  search.value = ''
  filterProjects.value = []
  filterTags.value = []
}

function projectTitle(slug: string) {
  return projects.value?.find(p => slugFromPath(p.path) === slug)?.title ?? slug
}

function projectIcon(slug: string) {
  return (projects.value?.find(p => slugFromPath(p.path) === slug) as any)?.icon ?? 'i-lucide-folder'
}

const showCreate = ref(false)
const createProject = ref<string>('')

function openCreate(projectSlug?: string) {
  createProject.value = projectSlug ?? (projects.value?.[0] ? slugFromPath(projects.value[0].path) : '')
  showCreate.value = true
}

async function onDocCreated(slug: string) {
  showCreate.value = false
  await navigateTo(`/projects/${createProject.value}/docs/${slug}`)
}
</script>

<template>
  <AppPageBase
    title="Docs"
    icon="i-lucide-book-open"
    :actions="projects?.length ? [{ label: 'New Doc', icon: 'i-lucide-plus', onSelect: () => openCreate() }] : []"
    :empty="!docs?.length"
    :empty-state="{
      icon: 'i-lucide-book-open',
      title: 'No docs yet',
      description: 'Create your first doc to capture project context.',
      actions: projects?.length ? [{ label: 'New Doc', icon: 'i-lucide-plus', onClick: () => openCreate() }] : [],
    }"
  >
    <div class="p-4 sm:p-6">
      <!-- Filter bar -->
      <div class="flex flex-wrap items-center gap-2 mb-4">
        <UInput
          v-model="search"
          placeholder="Search docs…"
          icon="i-lucide-search"
          size="sm"
          class="w-44"
        />
        <AppFilterMenu
          v-model="filterProjects"
          :items="projectSelectItems"
          placeholder="Projects"
        />
        <AppFilterMenu
          v-if="allTags.length"
          v-model="filterTags"
          :items="allTags"
          placeholder="Tags"
        />
        <USelect
          v-model="sortBy"
          :items="SORT_ITEMS"
          value-key="value"
          size="sm"
          class="w-36"
        />
        <UButton
          v-if="hasActiveFilter"
          icon="i-lucide-x"
          label="Clear"
          color="neutral"
          variant="ghost"
          size="sm"
          @click="clearFilters"
        />
        <span class="text-xs text-muted ml-auto">
          {{ filtered.length }} doc{{ filtered.length !== 1 ? 's' : '' }}
        </span>
      </div>

      <!-- Doc list -->
      <div class="flex flex-col divide-y divide-default rounded-lg border border-default overflow-hidden">
        <NuxtLink
          v-for="doc in filtered"
          :key="`${doc.project}/${doc.slug}`"
          :to="`/projects/${doc.project}/docs/${doc.slug}`"
          class="flex items-start gap-3 px-4 py-3 hover:bg-muted/50 transition-colors group"
        >
          <UIcon name="i-lucide-file-text" class="size-4 shrink-0 mt-0.5 text-muted" />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-medium text-sm group-hover:text-primary transition-colors truncate">{{ doc.title }}</span>
              <UBadge
                v-for="tag in doc.tags"
                :key="tag"
                :label="tag"
                color="neutral"
                variant="outline"
                size="xs"
              />
            </div>
            <div class="flex items-center gap-2 mt-0.5">
              <UIcon :name="projectIcon(doc.project)" class="size-3 shrink-0 text-muted" />
              <span class="text-xs text-muted">{{ projectTitle(doc.project) }}</span>
              <span class="text-xs text-muted">·</span>
              <span class="text-xs text-muted">{{ doc.updatedAt ? new Date(doc.updatedAt).toLocaleDateString() : doc.createdAt }}</span>
            </div>
            <p v-if="doc.excerpt" class="text-xs text-muted mt-1 line-clamp-1">
              {{ doc.excerpt }}
            </p>
          </div>
        </NuxtLink>
      </div>
    </div>

    <template #overlays>
      <DocForm
        v-if="showCreate && createProject"
        :project-slug="createProject"
        @close="showCreate = false"
        @saved="onDocCreated"
      />
    </template>
  </AppPageBase>
</template>
