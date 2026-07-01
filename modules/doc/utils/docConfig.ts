// Doc display config — canonical icons for the doc domain, previously repeated
// as string literals across the doc pages and list/tree components.
// NB: definePageMeta() needs statically-analyzable literals, so page-meta icons
// stay inline; these constants cover the runtime (template/JS) usages.
export const DOC_ICON = 'i-lucide-book-open'
export const DOC_FOLDER_ICON = 'i-lucide-folder'
export const DOC_FILE_ICON = 'i-lucide-file-text'
