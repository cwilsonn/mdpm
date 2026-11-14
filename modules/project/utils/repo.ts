// A project's `repo` is a repository URL (or a bare owner/repo for remotes without a web form).
// Only http(s) URLs become links; the label drops the scheme so it reads as host/owner/repo.
export const repoHref = (repo?: string | null) => (repo && /^https?:\/\//.test(repo) ? repo : undefined)
export const repoLabel = (repo?: string | null) => (repo ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '')
// Same rule as the server's write schema: an http(s) URL without credentials, or owner/repo.
export const isRepo = (value: string) => /^https?:\/\/[^\s/@]+\/\S+$/.test(value.trim()) || /^[\w.-]+\/[\w.-]+$/.test(value.trim())
