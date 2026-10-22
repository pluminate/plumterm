// Bundles and minifies the main-process code (main.js, server/, utils/) into out/main.js.
// node_modules stay external (node-pty is native and must stay unpacked).
import { build } from 'esbuild';
import { rmSync } from 'node:fs';

rmSync('out', { recursive: true, force: true });

await build({
  entryPoints: ['main.js'],
  outfile: 'out/main.js',
  bundle: true,
  minify: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'external',
  legalComments: 'none',
  sourcemap: false,
});

console.log('Bundled main process -> out/main.js');
