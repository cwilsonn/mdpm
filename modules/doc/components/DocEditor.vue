<script setup lang="ts">
import type { PageBreadcrumbItem, PageTab } from '../../_core/components/AppPageBase.vue'

const props = defineProps<{
  saveUrl: string
  deleteUrl: string
  afterDelete: string
  initialTitle: string
  initialTags: string[]
  initialBody: string
  initialArchivedAt?: string
  /** The loaded doc's updatedAt (null if it never had one): the base for the stale-edit check. */
  initialUpdatedAt: string | null
  fallbackTitle: string
  breadcrumb: PageBreadcrumbItem[]
  backTo?: string
  tabs?: PageTab[]
  autofocusTitle?: boolean
}>()

const title = ref(props.initialTitle)
const tags = ref([...props.initialTags])
const body = ref(props.initialBody)
const bodyLoaded = ref(false)

// Sent with every save, so the server refuses (409) instead of overwriting a change made elsewhere meanwhile
// (an agent's upsert_doc, `mdpm doc edit`, another tab). Rebased on each save's answer.
const baseUpdatedAt = ref<string | null>(props.initialUpdatedAt)

const { saving, busy, savedAt, saveError, savedAgo, conflict, scheduleSave, quietly, resolveConflict, initAutoSave, cleanupAutoSave } = useAutoSave(
  true,
  async () => {
    const res = await $fetch<{ ok: true, updatedAt?: string }>(props.saveUrl, {
      method: 'PATCH',
      body: { title: title.value, tags: tags.value, body: body.value, expectedUpdatedAt: baseUpdatedAt.value },
    })
    if (res.updatedAt) baseUpdatedAt.value = res.updatedAt
  },
)

type StoredDoc = { title: string, tags?: string[], body?: string, updatedAt: string | null }

// Put the stored version into the editor (local edits are dropped) without that counting as an edit.
async function applyStored(latest: StoredDoc) {
  await quietly(() => {
    title.value = latest.title
    if (titleEl.value) titleEl.value.innerText = latest.title
    tags.value = [...(latest.tags ?? [])]
    body.value = latest.body ?? ''
    baseUpdatedAt.value = latest.updatedAt ?? null
  })
}

const { docUrl } = useDocs()
const reloading = ref(false)

// After a conflict: take the latest version (local edits are dropped, as the message says), then resume saving.
async function reloadAfterConflict() {
  reloading.value = true
  try {
    await applyStored(await $fetch<StoredDoc>(props.saveUrl))
    remote.dismiss()
    resolveConflict()
  }
  catch {
    saveError.value = 'Reload failed; try again'
  }
  finally {
    reloading.value = false
  }
}

// Live updates: a change made elsewhere is loaded straight in while nobody is working in the page;
// while someone is (focus inside it), it is offered instead of swapped in under the cursor.
const pageEl = ref<HTMLElement | null>(null)
const remote = useRemoteRecord<StoredDoc>({
  match: e => (e.kind === 'doc' || e.kind === 'standalone-doc') && docUrl(e.project, e.slug) === props.saveUrl,
  base: baseUpdatedAt,
  busy,
  blocked: computed(() => conflict.value || !bodyLoaded.value),
  fetchLatest: () => $fetch<StoredDoc>(props.saveUrl),
  apply: applyStored,
  silent: () => !pageEl.value?.contains(document.activeElement),
})

watch(title, scheduleSave)
watch(tags, scheduleSave, { deep: true })
watch(body, scheduleSave)

const titleEl = ref<HTMLElement | null>(null)

onMounted(() => {
  if (titleEl.value) {
    titleEl.value.innerText = title.value
    if (props.autofocusTitle) {
      titleEl.value.focus()
      const range = document.createRange()
      range.selectNodeContents(titleEl.value)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    }
  }
  bodyLoaded.value = true
  initAutoSave()
})
onBeforeUnmount(() => cleanupAutoSave())

const showDeleteConfirm = ref(false)
const deleting = ref(false)

async function deleteDoc() {
  deleting.value = true
  try {
    await $fetch(props.deleteUrl, { method: 'DELETE' })
    await navigateTo(props.afterDelete)
  }
  finally {
    deleting.value = false
  }
}

const archivedAt = ref(props.initialArchivedAt)
const archiving = ref(false)

async function toggleArchive() {
  archiving.value = true
  const wasArchived = !!archivedAt.value
  try {
    await $fetch(props.saveUrl, {
      method: 'PATCH',
      body: { archivedAt: wasArchived ? null : new Date().toISOString() },
    })
    // Archiving drops the doc from the default list; unarchiving stays put.
    if (wasArchived) archivedAt.value = undefined
    else await navigateTo(props.afterDelete)
  }
  finally {
    archiving.value = false
  }
}

useHead(() => ({ title: title.value || props.fallbackTitle }))

const mobileActions = computed(() => [
  {
    label: archivedAt.value ? 'Unarchive doc' : 'Archive doc',
    icon: archivedAt.value ? 'i-lucide-archive-restore' : 'i-lucide-archive',
    onSelect: toggleArchive,
  },
  { label: 'Delete doc', icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: () => { showDeleteConfirm.value = true } },
])
</script>

<template>
  <AppPageBase
    :breadcrumb="breadcrumb"
    :back-to="backTo"
    :tabs="tabs"
    :mobile-actions="mobileActions"
  >
    <template #actions>
      <UButton
        :label="archivedAt ? 'Unarchive' : 'Archive'"
        :icon="archivedAt ? 'i-lucide-archive-restore' : 'i-lucide-archive'"
        color="neutral"
        variant="ghost"
        size="sm"
        :loading="archiving"
        @click="toggleArchive"
      />
      <UButton
        icon="i-lucide-trash-2"
        color="error"
        variant="ghost"
        size="sm"
        aria-label="Delete doc"
        @click="() => { showDeleteConfirm = true }"
      />
    </template>
    <template #right>
      <div class="flex items-center gap-1.5 text-xs text-muted">
        <AppSaveStatus
          :saving="saving"
          :save-error="saveError"
          :saved-at="savedAt"
          :saved-ago="savedAgo"
          idle-label="Auto-save on"
          :conflict="conflict"
          :reloading="reloading"
          :remote-changed="remote.changed.value"
          :remote-loading="remote.loading.value"
          @reload="reloadAfterConflict"
          @load-remote="remote.loadLatest"
        />
      </div>
    </template>

    <div ref="pageEl" class="overflow-y-auto flex-1 min-h-0">
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
          aria-label="Tags"
          variant="none"
          :ui="{ root: 'w-full p-0!' }"
        />

        <div v-if="!bodyLoaded" role="status" class="flex items-center gap-2 py-4 text-sm text-muted">
          <UIcon name="i-lucide-loader-2" class="size-4 animate-spin" />
          Loading…
        </div>
        <AppInputRichText
          v-else
          v-model="body"
          variant="none"
          aria-label="Doc content"
        />
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
