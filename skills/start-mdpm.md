Start the mdpm dev server if it isn't already running.

Steps:
1. Check if mdpm is already up by fetching http://mdpm.local:3333. If it responds, output:
   > ✓ mdpm is already running at http://mdpm.local:3333
   Then stop.
2. If not running, start the dev server in the background:
   Run: `pnpm --dir /Users/cody/dev/projects/mdpm dev`
   Use run_in_background so it doesn't block the session.
3. Wait up to 15 seconds for http://mdpm.local:3333 to respond (poll every 2s).
4. Once up, output:
   > ✓ mdpm started at http://mdpm.local:3333
5. If it doesn't come up within 15 seconds, output:
   > ⚠️ mdpm did not start in time. Check the terminal for errors.
