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

// cache busting: browsers (and GitHub Pages' 10-minute cache) must fetch the new bundle after a deploy
if (!watch) {
  const fs = await import('node:fs');
  const v = Date.now().toString(36);
  for (const p of ['public/index.html', 'public/teacher.html']) {
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/src="dist\/(\w+)\.js(\?v=\w+)?"/g, `src="dist/$1.js?v=${v}"`));
  }
}
