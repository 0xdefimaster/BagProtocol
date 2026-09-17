import { defineConfig } from 'vitest/config';
import path from 'path';

// This config's `include` covers `lib/**` (pure/server-side units — Node
// environment, no DOM) plus `hooks/**` (client React hooks — these opt
// into a `jsdom` environment per-file via a `// @vitest-environment jsdom`
// docblock at the top of the test file, rather than forcing jsdom as this
// whole config's global default, so the much larger `lib/**` suite keeps
// running under the faster, dependency-free `node` environment).
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    include: ['lib/**/*.test.ts', 'hooks/**/*.test.ts', 'hooks/**/*.test.tsx'],
  },
});
