import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// One self-contained dist/index.html: opens straight from disk (file://), which is what
// the Electron shell loads and what makes the web build work without a server.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 2000 },
  server: { port: 5173, strictPort: false },
});
