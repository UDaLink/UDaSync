import { rmSync, mkdirSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
console.log('[clean] dist/ 已重建');
