import * as esbuild from 'esbuild';
const watch = process.argv.includes('--watch');
const common = { bundle: true, minify: !watch, sourcemap: watch ? 'inline' : false, target: ['es2020'], logLevel: 'info', legalComments: 'none' };
const configs = [
  { ...common, entryPoints: ['src/app/main.js'], outfile: 'public/dist/app.js', format: 'esm' },
  { ...common, entryPoints: ['src/app/teacher.js'], outfile: 'public/dist/teacher.js', format: 'esm' },
  { ...common, entryPoints: ['src/engine/worker.js'], outfile: 'public/dist/engine-worker.js', format: 'iife' },
];
if (watch) { for (const c of configs) (await esbuild.context(c)).watch(); }
else await Promise.all(configs.map(c => esbuild.build(c)));
