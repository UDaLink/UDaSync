import { existsSync, readFileSync } from 'node:fs';

const required = [
  'dist/manifest.json',
  'dist/background.js',
  'dist/popup.html',
  'dist/options.html',
  'dist/icons/icon16.png',
  'dist/icons/icon32.png',
  'dist/icons/icon48.png',
  'dist/icons/icon128.png',
];

let failed = false;
for (const f of required) {
  if (!existsSync(f)) {
    console.error(`[verify] 缺失: ${f}`);
    failed = true;
  }
}

if (!failed) {
  const manifest = JSON.parse(readFileSync('dist/manifest.json', 'utf8'));
  if (manifest.manifest_version !== 3) {
    console.error('[verify] manifest_version 必须为 3');
    failed = true;
  }
  console.log(`[verify] OK · ${manifest.name} v${manifest.version}`);
}

process.exit(failed ? 1 : 0);
