<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

export interface FilterItem {
  label: string
  value: string
  icon?: string
  color?: string
  avatar?: { alt: string }
}

const props = defineProps<{
  items: FilterItem[]
  placeholder: string
  size?: 'xs' | 'sm' | 'md'
}>()

const model = defineModel<FilterItem[]>({ default: () => [] })

const dropdownItems = computed(() => [
  props.items.map(item => ({
    label: item.label,
    icon: item.icon,
    color: item.color,
    avatar: item.avatar,
    type: 'checkbox' as const,
    checked: model.value.some(s => s.value === item.value),
    onSelect(e: Event) {
      e.preventDefault()
      const current = [...model.value]
      const idx = current.findIndex(s => s.value === item.value)
      if (idx >= 0) current.splice(idx, 1)
      else current.push(item)
      model.value = current
    },
  })),
] as DropdownMenuItem[][])

const triggerLabel = computed(() => {
  if (!model.value.length) return props.placeholder
  if (model.value.length === 1) return model.value[0]?.label ?? props.placeholder
  return `${props.placeholder} · ${model.value.length}`
})

const isActive = computed(() => model.value.length > 0)
</script>

<template>
  <UDropdownMenu
    :items="dropdownItems"
    :content="{ align: 'start' }"
  >
    <template #item-leading="{ item }">
      <UAvatar
        v-if="item.avatar"
        v-bind="item.avatar"
        size="2xs"
      />
      <UIcon
        v-else-if="item.icon"
        :name="item.icon"
        class="size-4 shrink-0"
        :class="item.color ? `text-${item.color}` : 'text-muted'"
      />
    </template>

    <UButton
      :label="triggerLabel"
      trailing-icon="i-lucide-chevron-down"
      :color="isActive ? 'primary' : 'neutral'"
      :variant="isActive ? 'subtle' : 'outline'"
      :size="size ?? 'sm'"
    />
  </UDropdownMenu>
</template>
