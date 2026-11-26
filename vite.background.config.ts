import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

/**
 * Service worker 单独构建：必须输出为单文件 background.js，
 * 不能依赖 Vite 为多入口自动拆出来的共享 chunk（MV3 的 module service worker
 * 对静态导入支持有限，单文件最稳）。
 */
export default defineConfig({
  build: {
    outDir: resolve(root, 'dist'),
    emptyOutDir: false,
    target: 'chrome116',
    minify: false,
    sourcemap: true,
    lib: {
      entry: resolve(root, 'src/background/index.ts'),
      formats: ['es'],
      fileName: () => 'background.js',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
