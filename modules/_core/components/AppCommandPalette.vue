<script setup lang="ts">
const open = ref(false)
const searchTerm = ref('')

const { data: tasks } = await useAsyncData('search-tasks', () => $fetch('/api/tasks'))
const { data: projects } = await useAsyncData('search-projects', () => $fetch('/api/projects'))
const { data: allDocs } = await useAsyncData('search-docs', () => $fetch<{
  slug: string; project: string | null; title: string; excerpt: string
}[]>('/api/docs'))

type DocResult = { slug: string; project: string | null; title: string; excerpt: string }

const docResults = ref<DocResult[]>([])
const docsLoading = ref(false)

let debounceTimer: ReturnType<typeof setTimeout> | null = null

watch(searchTerm, (q) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  if (!q.trim()) {
    docResults.value = []
    docsLoading.value = false
    return
  }
  docsLoading.value = true
  debounceTimer = setTimeout(async () => {
    try {
      docResults.value = await $fetch<DocResult[]>('/api/search/docs', { query: { q } })
    }
    finally {
      docsLoading.value = false
    }
  }, 200)
})

const SESSION_NOTES_RE = /-session-notes$/

const defaultDocs = computed<DocResult[]>(() =>
  (allDocs.value ?? []).filter(d => !SESSION_NOTES_RE.test(d.slug)),
)

function projectTitleOf(taskPath: string) {
  const pSlug = taskPath.split('/')[2]
  return projects.value?.find(p => slugFromPath(p.path) === pSlug)?.title ?? pSlug
}

function projectTitleOfSlug(slug: string) {
  return projects.value?.find(p => slugFromPath(p.path) === slug)?.title ?? slug
}

function taskRoute(path: string) {
  const parts = path.split('/')
  return `/projects/${parts[2]}/tasks/${parts[4]}`
}

function docRoute(doc: DocResult) {
  return doc.project
    ? `/projects/${doc.project}/docs/${doc.slug}`
    : `/docs/${doc.slug}`
}

function docItems(docs: DocResult[]) {
  return docs.map(d => ({
    id: `doc:${d.project}:${d.slug}`,
    label: d.title,
    description: d.excerpt,
    suffix: d.project ? projectTitleOfSlug(d.project) : undefined,
    icon: 'i-lucide-file-text',
    to: docRoute(d),
  }))
}

const activeDocs = computed(() =>
  searchTerm.value.trim() ? docResults.value : defaultDocs.value,
)

const groups = computed(() => [
  {
    id: 'projects',
    label: 'Projects',
    items: (projects.value ?? []).map(p => ({
      id: p.path,
      label: p.title,
      icon: p.icon || 'i-lucide-folder',
      to: `/projects/${slugFromPath(p.path)}`,
    })),
  },
  {
    id: 'tasks',
    label: 'Tasks',
    items: (tasks.value ?? []).map(t => ({
      id: t.path,
      label: t.title,
      suffix: projectTitleOf(t.path),
      icon: 'i-lucide-check-square',
      to: taskRoute(t.path),
    })),
  },
  {
    id: 'docs',
    label: 'Docs',
    ignoreFilter: true,
    items: docItems(activeDocs.value),
  },
])
</script>

<template>
  <UDashboardSearch
    v-model:open="open"
    v-model:search-term="searchTerm"
    :groups="groups"
    :loading="docsLoading"
    placeholder="Search projects, tasks, and docs…"
    :color-mode="false"
  />
</template>
