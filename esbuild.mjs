import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const ctx = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  external: ['vscode'],
  outfile: 'dist/extension.js',
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
});
// Script that runs inside the Kanban webview (browser, no Node, no vscode module).
const webview = await esbuild.context({
  entryPoints: ['src/webview/board.ts'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  outfile: 'dist/board.js',
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
});
for (const c of [ctx, webview]) {
  if (process.argv.includes('--watch')) await c.watch();
  else { await c.rebuild(); await c.dispose(); }
}
