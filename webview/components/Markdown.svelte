<script lang="ts">
  import { renderMarkdown } from '../markdown';

  interface Props {
    text: string;
    /**
     * While true, incomplete markdown delimiters are softened so raw `**` / `` ` `` / half-links
     * do not flash on screen mid-token (same idea as Copilot / Claude chat).
     */
    streaming?: boolean;
  }

  let { text, streaming = false }: Props = $props();
  let root = $state<HTMLDivElement | null>(null);

  // renderMarkdown escapes everything before adding markup, so {@html} is safe here.
  const html = $derived(renderMarkdown(text, { streaming }));

  /**
   * Event delegation via native listener (not onclick on a non-interactive div) — code blocks
   * are {@html}, so copy buttons are not Svelte components.
   */
  $effect(() => {
    const el = root;
    if (!el) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const btn = target.closest('[data-md-copy]');
      if (!(btn instanceof HTMLButtonElement)) return;
      event.preventDefault();
      event.stopPropagation();
      void copyCode(btn);
    };
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  });

  async function copyCode(btn: HTMLButtonElement) {
    const wrap = btn.closest('.md-code-wrap');
    const code = wrap?.querySelector('pre.md-code code')?.textContent ?? '';
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // Webview clipboard can fail under strict permissions — fall back to a hidden textarea.
      const ta = document.createElement('textarea');
      ta.value = code;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } finally {
        ta.remove();
      }
    }
    // Toggle is CSS-only (`.md-copy.copied` swaps idle/done). Attribute `hidden` was ignored
    // once both spans had `display: inline-flex` in webview styles.
    btn.classList.add('copied');
    btn.setAttribute('aria-label', 'Copied');
    window.setTimeout(() => {
      btn.classList.remove('copied');
      btn.setAttribute('aria-label', 'Copy code');
    }, 1600);
  }
</script>

<div class="md" bind:this={root}>{@html html}</div>

<style>
  /*
   * Assistant prose needs more air than card chrome — sidebar chats read dense at 1.5/0.6em.
   * Aim for Claude-like open paragraphs without blowing the narrow column.
   */
  .md {
    line-height: 1.72;
    overflow-wrap: anywhere;
  }

  .md :global(p) {
    margin: 0 0 1.2em;
  }

  .md :global(p:last-child) {
    margin-bottom: 0;
  }

  .md :global(h1),
  .md :global(h2),
  .md :global(h3),
  .md :global(h4),
  .md :global(h5),
  .md :global(h6) {
    margin: 1.55em 0 0.65em;
    font-size: 1em;
    font-weight: 800;
    letter-spacing: -0.01em;
    line-height: 1.4;
  }

  .md :global(h1:first-child),
  .md :global(h2:first-child),
  .md :global(h3:first-child),
  .md :global(h4:first-child),
  .md :global(h5:first-child),
  .md :global(h6:first-child) {
    margin-top: 0.2em;
  }

  .md :global(h1) {
    font-size: 1.2em;
  }

  .md :global(h2) {
    font-size: 1.12em;
  }

  .md :global(ul),
  .md :global(ol) {
    margin: 0 0 1.2em;
    padding-left: 1.5em;
  }

  .md :global(li) {
    margin: 0.5em 0;
    line-height: 1.65;
  }

  .md :global(li > p) {
    margin: 0.4em 0;
  }

  .md :global(li > ul),
  .md :global(li > ol) {
    margin: 0.4em 0 0.55em;
  }

  .md :global(code) {
    font-family: var(--gb-mono);
    font-size: 0.92em;
    background: var(--gb-surface-sunken);
    border-radius: var(--gb-radius-sm);
    padding: 0.15em 0.4em;
  }

  /* Fenced block: head (lang + copy) over a sunken pre — same chrome as Copilot/Claude. */
  .md :global(.md-code-wrap) {
    margin: 1.2em 0;
    border: 1px solid var(--gb-rule);
    border-radius: var(--gb-radius);
    background: var(--gb-surface-sunken);
    overflow: hidden;
  }

  .md :global(.md-code-head) {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 32px;
    padding: 0 8px 0 12px;
    border-bottom: 1px solid var(--gb-rule);
    background: color-mix(in srgb, var(--vscode-editor-background) 55%, var(--gb-surface-sunken));
  }

  .md :global(.md-code-lang) {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--gb-mono);
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--gb-dim);
  }

  .md :global(.md-copy) {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin: 0;
    padding: 4px 8px;
    border: 1px solid transparent;
    border-radius: var(--gb-radius-sm);
    background: none;
    color: var(--gb-dim);
    font: inherit;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    line-height: 1;
  }

  .md :global(.md-copy:hover) {
    color: var(--vscode-foreground);
    border-color: var(--gb-rule);
    background: var(--vscode-toolbar-hoverBackground, rgba(128, 128, 128, 0.15));
  }

  .md :global(.md-copy.copied) {
    color: var(--gb-ok, var(--vscode-charts-green, #4caf50));
  }

  .md :global(.md-copy-idle),
  .md :global(.md-copy-done) {
    display: none;
    align-items: center;
    gap: 4px;
  }

  /* Default: only Copy. After click: only Copied. */
  .md :global(.md-copy:not(.copied) .md-copy-idle),
  .md :global(.md-copy.copied .md-copy-done) {
    display: inline-flex;
  }

  .md :global(.md-copy-icon) {
    display: block;
    flex: 0 0 auto;
  }

  .md :global(pre.md-code) {
    margin: 0;
    padding: 14px 16px;
    background: transparent;
    border: none;
    border-radius: 0;
  }

  .md :global(pre.md-code code) {
    background: none;
    padding: 0;
    font-size: 0.9em;
    line-height: 1.65;
    /* Same reasoning as the diff rows: sideways scrolling inside a narrow sidebar hides code
       instead of presenting it. pre-wrap keeps indentation, anywhere breaks unbreakable tokens. */
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .md :global(blockquote) {
    margin: 1.2em 0;
    padding: 0.45em 0 0.45em 14px;
    border-left: 3px solid var(--vscode-textBlockQuote-border, var(--gb-rule));
    color: var(--gb-dim);
    line-height: 1.65;
  }

  .md :global(a) {
    color: var(--gb-accent);
  }

  .md :global(hr) {
    border: none;
    border-top: 1px solid var(--gb-rule);
    margin: 1.45em 0;
  }

  .md :global(strong) {
    font-weight: 700;
  }

  /*
   * Tables scroll sideways in a narrow sidebar. Roomier cells so summary tables breathe.
   */
  .md :global(table) {
    display: block;
    width: max-content;
    max-width: 100%;
    overflow-x: auto;
    margin: 1.2em 0 1.35em;
    border: 1px solid var(--gb-rule);
    border-radius: var(--gb-radius);
    border-collapse: collapse;
    font-size: 0.95em;
    line-height: 1.5;
  }

  .md :global(th),
  .md :global(td) {
    padding: 10px 14px;
    border-bottom: 1px solid var(--gb-rule);
    text-align: left;
    vertical-align: top;
    overflow-wrap: normal;
  }

  .md :global(th + th),
  .md :global(td + td) {
    border-left: 1px solid var(--gb-rule);
  }

  .md :global(thead th) {
    background: var(--gb-surface-sunken);
    border-bottom: 2px solid var(--gb-rule-strong);
    font-weight: 800;
    font-size: 0.92em;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }

  .md :global(tbody tr:last-child td) {
    border-bottom: none;
  }

  .md :global(.md-center) {
    text-align: center;
  }

  .md :global(.md-right) {
    text-align: right;
  }

  .md :global(.md-left) {
    text-align: left;
  }

  @media (max-width: 280px) {
    .md :global(.md-copy-label) {
      display: none;
    }
  }
</style>
