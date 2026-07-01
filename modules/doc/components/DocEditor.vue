<script setup lang="ts">
import type { PageBreadcrumbItem, PageTab } from '../../_core/components/AppPageBase.vue'

const props = defineProps<{
  saveUrl: string
  deleteUrl: string
  afterDelete: string
  initialTitle: string
  initialTags: string[]
  initialBody: string
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

const isEdit = computed(() => true)

const { saving, savedAt, saveError, savedAgo, scheduleSave, initAutoSave, cleanupAutoSave } = useAutoSave(
  isEdit,
  async () => {
    await $fetch(props.saveUrl, {
      method: 'PATCH',
      body: { title: title.value, tags: tags.value, body: body.value },
    })
  },
)

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

useHead(() => ({ title: title.value || props.fallbackTitle }))

const mobileActions = [
  { label: 'Delete doc', icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: () => { showDeleteConfirm.value = true } },
]
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
        icon="i-lucide-trash-2"
        color="error"
        variant="ghost"
        size="sm"
        @click="() => { showDeleteConfirm = true }"
      />
    </template>
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
          :ui="{ root: 'w-full p-0!' }"
        />

        <div v-if="!bodyLoaded" class="flex items-center gap-2 py-4 text-sm text-muted">
          <UIcon name="i-lucide-loader-2" class="size-4 animate-spin" />
          Loading…
        </div>
        <AppInputRichText
          v-else
          v-model="body"
          variant="none"
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
