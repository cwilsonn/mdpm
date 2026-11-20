<script setup lang="ts">
// A task's history: its notes (stored in tasks/notes/<slug>.md), newest first, and a box to add one.
// Notes are append-only, so adding one needs no conflict check: the server appends under a lock.
import type { TaskNote } from '../types'

const props = defineProps<{
  projectSlug: string
  taskSlug: string
  notes: TaskNote[]
}>()

const emit = defineEmits<{ added: [] }>()

const { updateTask } = useTasks()
const { tryWithToast } = useApiToast()

const draft = ref('')
const saving = ref(false)
const newestFirst = computed(() => [...props.notes].reverse())

const stamp = (at: string) => new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

async function addNote() {
  const note = draft.value.trim()
  if (!note || saving.value) return
  saving.value = true
  try {
    if (await tryWithToast(() => updateTask(props.projectSlug, props.taskSlug, { note }), 'Failed to add note')) {
      draft.value = ''
      emit('added')
    }
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="space-y-4 border-t border-default pt-4">
    <p class="text-xs text-muted font-medium uppercase tracking-wide">
      History
      <span
        v-if="notes.length"
        class="normal-case tracking-normal font-normal"
      >· {{ notes.length }} {{ notes.length === 1 ? 'note' : 'notes' }}</span>
    </p>

    <form
      class="space-y-2"
      @submit.prevent="addNote"
    >
      <UTextarea
        v-model="draft"
        placeholder="Add a note: a decision, a blocker, what was verified…"
        aria-label="Add a note"
        class="w-full"
        :rows="2"
        autoresize
        @keydown.meta.enter.prevent="addNote"
        @keydown.ctrl.enter.prevent="addNote"
      />
      <div class="flex justify-end">
        <UButton
          type="submit"
          label="Add note"
          icon="i-lucide-message-square-plus"
          size="sm"
          variant="outline"
          :loading="saving"
          :disabled="!draft.trim()"
        />
      </div>
    </form>

    <p
      v-if="!notes.length"
      class="text-sm text-muted"
    >
      No notes yet.
    </p>
    <ol
      v-else
      class="space-y-4"
    >
      <li
        v-for="(n, i) in newestFirst"
        :key="`${n.at}-${i}`"
        class="border-l-2 border-default pl-3"
      >
        <p class="text-xs text-muted mb-1">
          <span
            v-if="n.author"
            class="font-medium text-toned"
          >{{ n.author }}</span>
          <span v-if="n.author"> · </span>
          <time :datetime="n.at">{{ stamp(n.at) }}</time>
        </p>
        <div class="prose prose-sm dark:prose-invert max-w-none">
          <MDC :value="n.text" />
        </div>
      </li>
    </ol>
  </section>
</template>
