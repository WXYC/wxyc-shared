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
  // Auth client (needs "use client" directive preserved)
  {
    entry: {
      'auth-client/index': 'src/auth-client/index.ts',
    },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    splitting: false,
    treeshake: true,
    async onSuccess() {
      addUseClientDirective('dist/auth-client/index.js');
    },
  },
] as Options[]);
