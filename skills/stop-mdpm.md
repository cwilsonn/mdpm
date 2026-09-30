Stop the mdpm dev server if it is running.

Steps:
1. Check if mdpm is running by fetching http://mdpm.local:3333. If it does NOT respond, output:
   > mdpm is not running
   Then stop.
2. Find the PIDs: run `lsof -ti tcp:3333`
   The dev server is usually two processes (Nuxt parent + child), so expect several newline-separated PIDs.
   If none found, output:
   > mdpm is not running
   Then stop.
3. Kill them all: `lsof -ti tcp:3333 | xargs kill`
   Do not capture the PIDs in a variable and pass it to `kill` — zsh won't split it and `kill` rejects the input.
4. Poll up to 5 seconds (every 1s) for the port to be free: `lsof -ti tcp:3333` returns nothing.
   (Don't fetch http://mdpm.local:3333 to check — resolving `.local` takes ~5s per request on macOS.)
5. Once port is free, output:
   > ✓ mdpm stopped
6. If port is still in use after 5 seconds, output:
   > ⚠️ mdpm did not stop in time. Try: lsof -ti tcp:3333 | xargs kill -9
