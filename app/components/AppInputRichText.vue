<script setup lang="ts">
import type { EditorToolbarItem } from '@nuxt/ui'

const model = defineModel<string>({ default: '' })

const toolbarItems: EditorToolbarItem[][] = [[
  { kind: 'undo', icon: 'i-lucide-undo', tooltip: { text: 'Undo' } },
  { kind: 'redo', icon: 'i-lucide-redo', tooltip: { text: 'Redo' } },
], [
  {
    icon: 'i-lucide-heading',
    tooltip: { text: 'Headings' },
    items: [
      { kind: 'heading', level: 1, icon: 'i-lucide-heading-1', label: 'Heading 1' },
      { kind: 'heading', level: 2, icon: 'i-lucide-heading-2', label: 'Heading 2' },
      { kind: 'heading', level: 3, icon: 'i-lucide-heading-3', label: 'Heading 3' },
    ],
  },
  {
    icon: 'i-lucide-list',
    tooltip: { text: 'Lists' },
    items: [
      { kind: 'bulletList', icon: 'i-lucide-list', label: 'Bullet List' },
      { kind: 'orderedList', icon: 'i-lucide-list-ordered', label: 'Ordered List' },
    ],
  },
  { kind: 'blockquote', icon: 'i-lucide-text-quote', tooltip: { text: 'Blockquote' } },
  { kind: 'codeBlock', icon: 'i-lucide-square-code', tooltip: { text: 'Code Block' } },
], [
  { kind: 'mark', mark: 'bold', icon: 'i-lucide-bold', tooltip: { text: 'Bold' } },
  { kind: 'mark', mark: 'italic', icon: 'i-lucide-italic', tooltip: { text: 'Italic' } },
  { kind: 'mark', mark: 'strike', icon: 'i-lucide-strikethrough', tooltip: { text: 'Strike' } },
  { kind: 'mark', mark: 'code', icon: 'i-lucide-code', tooltip: { text: 'Inline Code' } },
]]
</script>

<template>
  <UEditor
    v-slot="{ editor }"
    v-model="model"
    content-type="markdown"
    placeholder="Add a description…"
    class="w-full rounded-lg border border-default overflow-hidden"
    :ui="{ base: 'min-h-36 p-3 text-sm' }"
  >
    <UEditorToolbar
      :editor="editor"
      :items="toolbarItems"
      class="border-b border-default px-2 py-1 bg-muted/30 overflow-x-auto sticky top-0 z-10"
    />
  </UEditor>
</template>
