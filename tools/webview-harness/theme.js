/**
 * VS Code theme tokens for the harness.
 *
 * The real webview inherits these from the editor; standalone we have to supply them, otherwise
 * every `var(--vscode-*)` falls back and the UI lies about how it looks. Values are lifted from
 * Dark Modern / Light Modern.
 */

export const dark = {
  'font-family': "system-ui, 'Segoe UI', sans-serif",
  'font-size': '13px',
  foreground: '#cccccc',
  focusBorder: '#0078d4',
  'widget-border': '#313131',
  'icon-foreground': '#cccccc',
  descriptionForeground: '#9d9d9d',
  errorForeground: '#f85149',
  'editor-background': '#1f1f1f',
  'editor-font-family': "Consolas, 'Courier New', monospace",
  'sideBar-background': '#181818',
  'editorWidget-background': '#202020',
  'textBlockQuote-background': '#2a2a2a',
  'textBlockQuote-border': '#454545',
  'textCodeBlock-background': '#2a2a2a',
  'textLink-foreground': '#4daafc',
  'badge-background': '#616161',
  'badge-foreground': '#f8f8f8',
  'button-background': '#0078d4',
  'button-foreground': '#ffffff',
  'button-hoverBackground': '#026ec1',
  'button-border': 'transparent',
  'button-secondaryBackground': '#313131',
  'button-secondaryForeground': '#cccccc',
  'button-secondaryHoverBackground': '#3c3c3c',
  'dropdown-background': '#313131',
  'dropdown-foreground': '#cccccc',
  'dropdown-border': '#3c3c3c',
  'input-background': '#313131',
  'input-foreground': '#cccccc',
  'input-border': '#3c3c3c',
  'inputValidation-errorBorder': '#be1100',
  'inputValidation-warningBackground': '#352a05',
  'inputValidation-warningBorder': '#b89500',
  'list-hoverBackground': '#2a2d2e',
  'list-activeSelectionBackground': '#04395e',
  'list-activeSelectionForeground': '#ffffff',
  'toolbar-hoverBackground': 'rgba(90, 93, 94, 0.31)',
  'progressBar-background': '#0078d4',
  'editorLineNumber-foreground': '#6e7681',
  'diffEditor-insertedTextBackground': 'rgba(63, 185, 80, 0.16)',
  'diffEditor-removedTextBackground': 'rgba(248, 81, 73, 0.16)',
  'gitDecoration-addedResourceForeground': '#81b88b',
  'gitDecoration-deletedResourceForeground': '#c74e39',
  'charts-blue': '#4a9eff',
  'charts-green': '#89d185',
  'charts-yellow': '#d7ba7d',
  'charts-purple': '#b180d7',
};

/**
 * Spreading `dark` is a convenience, not a claim that the rest matches — anything with a
 * light-specific value has to be listed here. A token left inherited (the `writes` badge once
 * sat on Dark Modern's near-black warning surface) makes the harness show a bug that VS Code
 * would never show, or hide one it would.
 */
export const light = {
  ...dark,
  foreground: '#3b3b3b',
  focusBorder: '#005fb8',
  'widget-border': '#e5e5e5',
  'icon-foreground': '#3b3b3b',
  descriptionForeground: '#616161',
  errorForeground: '#d32f2f',
  'editor-background': '#ffffff',
  'sideBar-background': '#f8f8f8',
  'editorWidget-background': '#f8f8f8',
  'textBlockQuote-background': '#f0f0f0',
  'textBlockQuote-border': '#d4d4d4',
  'textCodeBlock-background': '#f0f0f0',
  'textLink-foreground': '#005fb8',
  'badge-background': '#cccccc',
  'badge-foreground': '#3b3b3b',
  'button-background': '#005fb8',
  'button-hoverBackground': '#0258a8',
  'button-secondaryBackground': '#e5e5e5',
  'button-secondaryForeground': '#3b3b3b',
  'button-secondaryHoverBackground': '#dadada',
  'dropdown-background': '#ffffff',
  'dropdown-foreground': '#3b3b3b',
  'dropdown-border': '#cecece',
  'input-background': '#ffffff',
  'input-foreground': '#3b3b3b',
  'input-border': '#cecece',
  'inputValidation-errorBorder': '#e51400',
  'inputValidation-warningBackground': '#f6f5d2',
  'inputValidation-warningBorder': '#b89500',
  'list-hoverBackground': '#f0f0f0',
  'list-activeSelectionBackground': '#0060c0',
  'toolbar-hoverBackground': 'rgba(184, 184, 184, 0.31)',
  'progressBar-background': '#005fb8',
  'editorLineNumber-foreground': '#6e7681',
  'diffEditor-insertedTextBackground': 'rgba(155, 185, 85, 0.2)',
  'diffEditor-removedTextBackground': 'rgba(255, 0, 0, 0.12)',
  'gitDecoration-addedResourceForeground': '#587c0c',
  'gitDecoration-deletedResourceForeground': '#ad0707',
  'charts-blue': '#1a85ff',
  'charts-green': '#388a34',
  'charts-yellow': '#b5900b',
  'charts-purple': '#652d90',
};

export function applyTheme(name) {
  const tokens = name === 'light' ? light : dark;
  const root = document.documentElement;
  for (const [key, value] of Object.entries(tokens)) {
    root.style.setProperty(`--vscode-${key}`, value);
  }
  root.dataset.theme = name;
}
