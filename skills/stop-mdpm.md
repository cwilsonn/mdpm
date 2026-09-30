Stop the mdpm dev server if it is running.

Steps:
1. Run `mdpm stop`. It is idempotent: if the server is down it reports that and exits 0.
2. Relay its output. On a non-zero exit, show the error and stop.
3. If the shell reports `mdpm: command not found`, tell the user to install the CLI from the mdpm checkout: `pnpm add --global "link:$(pwd)"`.
