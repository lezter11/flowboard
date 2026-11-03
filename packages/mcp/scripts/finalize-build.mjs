import { chmod } from 'node:fs/promises';

// Ensure the advertised bin is executable in a compiled or packed install.
await chmod(new URL('../dist/index.js', import.meta.url), 0o755);
