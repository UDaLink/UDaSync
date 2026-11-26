import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

/**
 * UI（popup / options）单独构建：以 ui/ 为 Vite root，
 * 产物直接落在 dist/popup.html、dist/options.html，与 manifest.json 对应。
 */
export default defineConfig({
  root: resolve(root, 'ui'),
  publicDir: resolve(root, 'public'),
  build: {
    outDir: resolve(root, 'dist'),
    emptyOutDir: false,
    target: 'chrome116',
    minify: false,
    sourcemap: true,
    rollupOptions: {
      input: {
        popup: resolve(root, 'ui/popup.html'),
        options: resolve(root, 'ui/options.html'),
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
});
