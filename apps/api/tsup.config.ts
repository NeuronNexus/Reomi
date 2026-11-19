import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    server: 'src/server.ts',
    release: 'src/db/cli/release.ts',
    'grant-admin': 'src/db/cli/grant-admin.ts',
  },
  format: 'esm',
  target: 'node22',
  platform: 'node',
  clean: true,
  sourcemap: true,
  // The shared package ships TypeScript source, so it has to be compiled into the bundle.
  noExternal: ['@reomi/shared'],
});
