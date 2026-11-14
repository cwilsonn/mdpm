// Demo mode: the public sandbox that wipes and re-seeds its content every hour and caps how much
// a visitor can create. Opt-in through MDPM_DEMO=1 (set on Railway), never inferred.
//
// It used to hang off NODE_ENV === 'production', but the production build inlines NODE_ENV, so a
// local `pnpm build && pnpm start` compiled the guards away and wiped content/projects at boot.
// The bracket access keeps the bundler from inlining this one; a test forbids NODE_ENV in server/.
export function isDemo() {
  return process.env['MDPM_DEMO'] === '1'
}
