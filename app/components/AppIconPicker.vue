<script setup lang="ts">
const model = defineModel<string>({ default: '' })

const { data: iconNames } = await useFetch<string[]>('/api/icons/lucide')

const items = computed(() =>
  (iconNames.value ?? []).map(name => ({
    label: name,
    value: `i-lucide-${name}`,
    icon: `i-lucide-${name}`,
  })),
)
</script>

<template>
  <div class="flex items-center gap-2">
    <USelectMenu
      v-model="model"
      :items="items"
      value-key="value"
      searchable
      placeholder="Search icons…"
      class="flex-1"
      :search-attributes="['label']"
      :virtualize="{ overscan: 10 }"
    >
      <template #leading>
        <UIcon
          v-if="model"
          :name="model"
          class="size-4 shrink-0"
        />
      </template>
    </USelectMenu>

    <div class="flex items-center justify-center size-9 border border-default rounded-md shrink-0 bg-muted/30">
      <UIcon
        v-if="model"
        :name="model"
        class="size-5 text-primary"
      />
      <UIcon
        v-else
        name="i-lucide-image"
        class="size-5 text-muted"
      />
    </div>

    <UButton
      v-if="model"
      icon="i-lucide-x"
      color="neutral"
      variant="ghost"
      size="sm"
      @click="model = ''"
    />
  </div>
</template>
