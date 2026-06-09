<script setup lang="ts">
const route = useRoute()
const projectSlug = computed(() => route.params.slug as string)
const docSlug = computed(() => route.params.doc as string)

interface DocDetail {
  slug: string
  project: string
  title: string
  tags: string[]
  createdAt: string
  updatedAt?: string
  body: string
}

interface ProjectHeader { slug: string; path: string; title: string; icon?: string; status: string }

const { data: project } = await useAsyncData(
  () => `project-${projectSlug.value}`,
  () => $fetch<ProjectHeader>(`/api/projects/${projectSlug.value}`).catch(() => null),
)

const { data: docMeta, refresh } = await useAsyncData(
  () => `doc-${projectSlug.value}-${docSlug.value}`,
  () => $fetch<DocDetail>(`/api/docs/${projectSlug.value}/${docSlug.value}`),
)

if (!docMeta.value) {
  throw createError({ statusCode: 404, message: 'Doc not found' })
}

const title = ref(docMeta.value.title)
const tags = ref([...(docMeta.value.tags ?? [])])
const body = ref(docMeta.value.body ?? '')
const bodyLoaded = ref(false)

const isEdit = computed(() => true)

const { saving, savedAt, saveError, savedAgo, scheduleSave, flushSave, initAutoSave, cleanupAutoSave } = useAutoSave(
  isEdit,
  async () => {
    await $fetch(`/api/docs/${projectSlug.value}/${docSlug.value}`, {
      method: 'PATCH',
      body: { title: title.value, tags: tags.value, body: body.value },
    })
  },
)

watch(title, scheduleSave)
watch(tags, scheduleSave, { deep: true })
watch(body, scheduleSave)

onMounted(() => {
  if (titleEl.value) titleEl.value.innerText = title.value
  bodyLoaded.value = true
  initAutoSave()
})
onBeforeUnmount(() => cleanupAutoSave())

const titleEl = ref<HTMLElement | null>(null)

const showDeleteConfirm = ref(false)
const deleting = ref(false)

async function deleteDoc() {
  deleting.value = true
  try {
    await $fetch(`/api/docs/${projectSlug.value}/${docSlug.value}`, { method: 'DELETE' })
    await navigateTo(`/projects/${projectSlug.value}/docs`)
  }
  finally {
    deleting.value = false
  }
}

useHead(() => ({ title: title.value || docSlug.value }))

const projectsMeta = resolveRouteMeta('/projects')
const breadcrumb = computed(() => [
  { label: projectsMeta.label ?? 'Projects', to: '/projects', icon: projectsMeta.icon },
  { label: project.value?.title ?? projectSlug.value, to: `/projects/${projectSlug.value}/docs`, icon: (project.value as any)?.icon || undefined },
  { label: title.value || docSlug.value },
])

const mobileActions = [
  { label: 'Delete doc', icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: () => { showDeleteConfirm.value = true } },
]
</script>

<template>
  <AppPageBase :breadcrumb="breadcrumb" :back-to="`/projects/${projectSlug}/docs`" :mobile-actions="mobileActions">
    <template #actions>
      <UButton
        icon="i-lucide-trash-2"
        color="error"
        variant="ghost"
        size="sm"
        @click="showDeleteConfirm = true"
      />
    </template>
    <!-- Save status always visible on all screen sizes -->
    <template #right>
      <div class="flex items-center gap-1.5 text-xs text-muted">
        <UIcon v-if="saving" name="i-lucide-loader-2" class="size-3.5 animate-spin shrink-0" />
        <UIcon v-else-if="saveError" name="i-lucide-triangle-alert" class="size-3.5 shrink-0 text-error" />
        <UIcon v-else-if="savedAt" name="i-lucide-check" class="size-3.5 shrink-0 text-success" />
        <span :class="saveError ? 'text-error' : ''">
          <template v-if="saving">Saving…</template>
          <template v-else-if="saveError">{{ saveError }}</template>
          <template v-else-if="savedAt">Saved {{ savedAgo }}</template>
          <template v-else>Auto-save on</template>
        </span>
      </div>
    </template>

    <div class="overflow-y-auto flex-1 min-h-0">
    <div class="max-w-4xl mx-auto space-y-4">
      <h1
        ref="titleEl"
        contenteditable="plaintext-only"
        data-placeholder="Doc title"
        class="w-full text-4xl font-bold outline-none empty:before:content-[attr(data-placeholder)] empty:before:text-muted"
        @input="title = ($event.target as HTMLElement).innerText"
        @keydown.enter.prevent="($event.target as HTMLElement).blur()"
      />

      <UInputTags
        v-model="tags"
        placeholder="Add tags…"
        variant="none"
        class="w-full"
      />

      <div class="border-t border-default pt-4">
        <div v-if="!bodyLoaded" class="flex items-center gap-2 py-4 text-sm text-muted">
          <UIcon name="i-lucide-loader-2" class="size-4 animate-spin" />
          Loading…
        </div>
        <AppInputRichText
          v-else
          v-model="body"
          class="w-full min-h-96"
        />
      </div>
    </div>
    </div>

    <template #overlays>
      <AppConfirmDialog
        :open="showDeleteConfirm"
        title="Delete doc?"
        message="This cannot be undone."
        confirm-label="Delete"
        :loading="deleting"
        @update:open="showDeleteConfirm = false"
        @confirm="deleteDoc"
        @cancel="showDeleteConfirm = false"
      />
    </template>
  </AppPageBase>
</template>
