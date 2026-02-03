import { defineConfig, type Options } from 'tsup';
import { writeFileSync, readFileSync } from 'fs';

const addUseClientDirective = (filePath: string) => {
  const content = readFileSync(filePath, 'utf-8');
  if (!content.startsWith('"use client"')) {
    writeFileSync(filePath, `"use client";\n${content}`);
  }
};

export default defineConfig([
  // Main entries (non-client)
  {
    entry: {
      index: 'src/index.ts',
      'dtos/index': 'src/dtos/index.ts',
      'test-utils/index': 'src/test-utils/index.ts',
      'validation/index': 'src/validation/index.ts',
    },
    format: ['esm'],
    dts: true,
    clean: true,
    sourcemap: true,
    splitting: false,
    treeshake: true,
  },
  // Auth client entries (index needs "use client" directive)
  {
    entry: {
      'auth-client/index': 'src/auth-client/index.ts',
      'auth-client/auth': 'src/auth-client/auth.ts',
    },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    splitting: false,
    treeshake: true,
    async onSuccess() {
      // Only add "use client" to the index.js, not auth.js
      addUseClientDirective('dist/auth-client/index.js');
    },
  },
] as Options[]);
