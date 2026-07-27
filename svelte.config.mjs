import { sveltePreprocess } from 'svelte-preprocess';

/**
 * One preprocessor definition for both the esbuild bundle (imported by esbuild.mjs) and
 * svelte-check (which picks this file up on its own).
 *
 * The tsconfig choice is the important part. svelte-preprocess runs the TypeScript transpiler
 * over `<script lang="ts">`, and without `verbatimModuleSyntax` TS drops the component imports —
 * they are only referenced from the markup, which it cannot see. That produces a bundle that
 * compiles and typechecks cleanly and then throws `X is not defined` in the browser. The host
 * tsconfig.json cannot turn the flag on (Node16 + CommonJS), so both tools are pointed at the
 * config that actually describes these files.
 */
export default {
  preprocess: sveltePreprocess({ typescript: { tsconfigFile: 'tsconfig.webview.json' } }),
};
