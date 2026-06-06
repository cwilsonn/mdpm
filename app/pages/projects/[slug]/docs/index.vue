<script setup lang="ts">
const route = useRoute()
const slug = computed(() => route.params.slug as string)

interface ProjectHeader { slug: string; path: string; title: string; icon?: string; status: string }

const { data: project } = await useAsyncData(
  () => `project-${slug.value}`,
  () => $fetch<ProjectHeader>(`/api/projects/${slug.value}`).catch(() => null),
)

if (!project.value) {
  throw createError({ statusCode: 404, message: 'Project not found' })
}

interface DocItem {
  slug: string
  project: string
  title: string
  tags: string[]
  createdAt: string
  updatedAt?: string
  excerpt: string
}

const { data: docs, refresh: refreshDocs, pending: docsPending } = await useAsyncData(
  () => `docs-${slug.value}`,
  () => $fetch<DocItem[]>(`/api/docs/${slug.value}`),
)

const showCreateDoc = ref(false)

async function onDocCreated(docSlug: string) {
  showCreateDoc.value = false
  await navigateTo(`/projects/${slug.value}/docs/${docSlug}`)
}

useHead(() => ({ title: `${project.value?.title ?? slug.value} — Docs` }))

const breadcrumb = computed(() => [
  { label: 'Projects', to: '/projects', icon: 'i-lucide-folder' },
  { label: project.value?.title ?? slug.value, icon: (project.value as any)?.icon || undefined },
])

const tabs = computed(() => [
  { label: 'Tasks', icon: 'i-lucide-list-checks', to: `/projects/${slug.value}`, exact: true },
  { label: 'Docs', icon: 'i-lucide-book-open', to: `/projects/${slug.value}/docs` },
])
</script>

<template>
  <AppPageBase :breadcrumb="breadcrumb" :tabs="tabs">
    <template #actions>
      <UButton
        label="New Doc"
        icon="i-lucide-plus"
        size="sm"
        @click="showCreateDoc = true"
      />
    </template>

    <div class="" :class="docsPending ? 'opacity-50 pointer-events-none' : 'transition-opacity'">
      <div v-if="!docs?.length" class="flex flex-col items-center justify-center py-16 text-center gap-3">
        <UIcon name="i-lucide-book-open" class="size-10 text-muted" />
        <p class="text-muted text-sm">No docs yet for this project.</p>
        <UButton label="Create first doc" icon="i-lucide-plus" size="sm" @click="showCreateDoc = true" />
      </div>
      <div v-else class="flex flex-col divide-y divide-default">
        <NuxtLink
          v-for="doc in docs"
          :key="doc.slug"
          :to="`/projects/${slug}/docs/${doc.slug}`"
          class="flex items-start gap-3 p-4 hover:bg-muted/50 transition-colors group"
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
                size="sm"
              />
            </div>
            <div class="flex items-center gap-1.5 mt-0.5">
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
        v-if="showCreateDoc"
        :project-slug="slug"
        @close="showCreateDoc = false"
        @saved="onDocCreated"
      />
    </template>
  </AppPageBase>
</template>
