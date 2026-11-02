import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Testy běží proti zdrojákům core, bez nutnosti ho buildit.
    alias: { 'cz-eet2-core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)) },
  },
  test: {
    dir: 'test',
  },
});
