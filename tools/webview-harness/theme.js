/**
 * Theme for the harness.
 *
 * The webview no longer inherits anything from the editor — it ships its own tokens in
 * `webview/styles/tokens.css` and switches on `data-theme`. So all this has to do is what
 * `App.svelte` does in the real extension: write the attribute and let the bundled sheet answer.
 *
 * It used to hand-supply ~60 `--vscode-*` values lifted from Dark Modern / Light Modern. Those are
 * gone from the webview, and keeping them here would only invite a component to quietly depend on
 * one again. The single exception below is the same one `--font-mono` still falls back to.
 */

/** What VS Code would supply for the editor's own monospace family. */
const EDITOR_MONO = "Consolas, 'Courier New', monospace";

/**
 * @param {'dark' | 'light'} name
 */
export function applyTheme(name) {
  const theme = name === 'light' ? 'light' : 'dark';
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.setProperty('--vscode-editor-font-family', EDITOR_MONO);
  // `color-scheme` comes from the theme block in tokens.css; setting it inline here would win over
  // the sheet and freeze the UA widgets at whatever the URL said on load.
}
