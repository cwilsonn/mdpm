Stop the mdpm dev server if it is running.

Steps:
1. Check if mdpm is running by fetching http://mdpm.local:3333. If it does NOT respond, output:
   > mdpm is not running
   Then stop.
2. Find the PID: run `lsof -ti tcp:3333`
   If no PID found, output:
   > mdpm is not running
   Then stop.
3. Kill the process: `kill <PID>`
4. Poll up to 5 seconds (every 1s) for the port to be free by fetching http://mdpm.local:3333.
5. Once port is free, output:
   > ✓ mdpm stopped
6. If port is still in use after 5 seconds, output:
   > ⚠️ mdpm did not stop in time. Try: kill -9 <PID>
