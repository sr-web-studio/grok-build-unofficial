import { readdirSync } from 'node:fs';
import { posix } from 'node:path';

import { build, context } from 'esbuild';
import esbuildSvelte from 'esbuild-svelte';

import svelteConfig from './svelte.config.mjs';

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

/**
 * Every `.svelte` file under webview/ must end up in the bundle.
 *
 * This is not paranoia: svelte-preprocess runs the TypeScript transpiler over `<script lang="ts">`,
 * and TS drops imports it cannot see used — component imports are only used in the markup. The
 * result compiles and typechecks cleanly, then throws `X is not defined` in the browser. The
 * guard against that is `verbatimModuleSyntax` (below), and this check is how we notice if the
 * preprocessor ever stops honouring it.
 */
function assertAllComponentsBundled(metafile) {
  const inputs = new Set(Object.keys(metafile.inputs));
  const missing = svelteFiles('webview').filter((f) => !inputs.has(f));
  if (missing.length > 0) {
    throw new Error(`svelte components missing from the bundle: ${missing.join(', ')}`);
  }
}

function svelteFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = posix.join(dir, entry.name);
    if (entry.isDirectory()) return svelteFiles(path);
    return entry.name.endsWith('.svelte') ? [path] : [];
  });
}

/** Extension host: CommonJS, node platform, `vscode` is provided by the runtime. */
const hostConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['vscode'],
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

/** Webview: ESM in the browser sandbox, Svelte 5 compiled to a single file. */
const webviewConfig = {
  entryPoints: ['webview/main.ts'],
  bundle: true,
  outfile: 'dist/webview.js',
  platform: 'browser',
  target: 'es2022',
  format: 'esm',
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
  mainFields: ['svelte', 'browser', 'module', 'main'],
  conditions: ['svelte', 'browser'],
  metafile: true,
  plugins: [
    esbuildSvelte({
      preprocess: svelteConfig.preprocess,
      compilerOptions: { dev: !production, css: 'injected' },
    }),
    {
      name: 'assert-components-bundled',
      setup(pluginBuild) {
        pluginBuild.onEnd((result) => {
          if (result.metafile) assertAllComponentsBundled(result.metafile);
        });
      },
    },
  ],
};

if (watch) {
  const ctxs = await Promise.all([context(hostConfig), context(webviewConfig)]);
  await Promise.all(ctxs.map((c) => c.watch()));
  console.log('[esbuild] watching host + webview');
} else {
  await Promise.all([build(hostConfig), build(webviewConfig)]);
}
