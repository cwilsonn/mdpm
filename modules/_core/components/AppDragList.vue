<script setup lang="ts" generic="T">
import { VueDraggable } from 'vue-draggable-plus'

// Generic drag-reorder list. Wraps VueDraggable with the project's standard
// config (shared group semantics, animation, ghost/filter classes) and a typed
// drag-event contract, so consumers (kanban columns, TaskStatusGroup, …) stop
// re-declaring the same plumbing. Content is provided via slots; every slot is
// re-exposed to VueDraggable transparently (default for items, plus any
// header/footer slots the library supports) so this primitive stays
// domain-agnostic.
const model = defineModel<T[]>({ required: true })

withDefaults(defineProps<{
  /** Shared drag group name — lists with the same name can exchange items. */
  group: string
  /** Allow reordering within the list (false = drop-only target). */
  sort?: boolean
}>(), {
  sort: true,
})

const emit = defineEmits<{
  'drag-start': []
  'drag-end': []
  'drag-add': [evt: { newIndex?: number }]
  'drag-update': []
}>()
</script>

<template>
  <VueDraggable
    v-model="model"
    :group="{ name: group, pull: true, put: true }"
    :sort="sort"
    :animation="150"
    ghost-class="opacity-40"
    filter=".drag-ignore"
    @start="emit('drag-start')"
    @end="emit('drag-end')"
    @add="(e: { newIndex?: number }) => emit('drag-add', e)"
    @update="emit('drag-update')"
  >
    <template v-for="(_, name) in $slots" #[name]="scope">
      <slot :name="name" v-bind="scope ?? {}" />
    </template>
  </VueDraggable>
</template>
