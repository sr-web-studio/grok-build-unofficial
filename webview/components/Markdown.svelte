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
    }, 1200);
  }
</script>

<div class="md" bind:this={root}>{@html html}</div>

<style>
  /* §2 / §7.5 — body 13.5/1.70, measure owned by the transcript parent. */
  .md {
    font-size: 13.5px;
    line-height: 1.7;
    overflow-wrap: anywhere;
    color: var(--text);
  }

  .md :global(p) {
    margin: 0 0 var(--space-3);
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
    font-weight: 600;
    letter-spacing: -0.01em;
    line-height: 1.35;
    color: var(--text);
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
    font-size: 17px;
  }

  .md :global(h2) {
    font-size: 15.5px;
  }

  .md :global(h3) {
    font-size: 14px;
  }

  .md :global(h4),
  .md :global(h5),
  .md :global(h6) {
    font-size: 13.5px;
  }

  .md :global(ul),
  .md :global(ol) {
    margin: 0 0 var(--space-3);
    padding-left: var(--space-4);
    line-height: 1.65;
  }

  .md :global(li) {
    margin: 0.35em 0;
    line-height: 1.65;
  }

  .md :global(li::marker) {
    color: var(--text-faint);
  }

  .md :global(li > p) {
    margin: 0.4em 0;
  }

  .md :global(li > ul),
  .md :global(li > ol) {
    margin: 0.4em 0 0.55em;
  }

  .md :global(code) {
    font-family: var(--font-mono);
    font-size: 12.5px;
    background: var(--bg-inset);
    border-radius: var(--radius-sm);
    padding: 0 4px;
    color: var(--text);
  }

  /* Fenced blocks: inset surface, no border; lang + copy absolutely positioned. */
  .md :global(.md-code-wrap) {
    margin: var(--space-3) 0;
    border-radius: var(--radius-md);
    background: var(--bg-inset);
    overflow: hidden;
    position: relative;
  }

  .md :global(.md-code-head) {
    position: absolute;
    top: 6px;
    right: 8px;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    pointer-events: none;
  }

  .md :global(.md-code-lang) {
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-faint);
    pointer-events: none;
  }

  .md :global(.md-copy) {
    pointer-events: auto;
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin: 0;
    padding: 2px 6px;
    border: none;
    border-radius: var(--radius-sm);
    background: var(--bg-hover);
    color: var(--text-muted);
    font: inherit;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    line-height: 1;
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease-standard);
  }

  .md :global(.md-code-wrap:hover .md-copy),
  .md :global(.md-copy:focus-visible) {
    opacity: 1;
  }

  .md :global(.md-copy.copied) {
    color: var(--success);
    opacity: 1;
  }

  .md :global(.md-copy-idle),
  .md :global(.md-copy-done) {
    display: none;
    align-items: center;
    gap: 4px;
  }

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
    padding: var(--space-3);
    padding-top: 28px;
    background: transparent;
    border: none;
    border-radius: 0;
    overflow-x: auto;
  }

  .md :global(pre.md-code code) {
    background: none;
    padding: 0;
    font-size: 12.5px;
    line-height: 1.55;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .md :global(blockquote) {
    margin: var(--space-3) 0;
    padding: 0 0 0 var(--space-3);
    border-left: 2px solid var(--border-strong);
    color: var(--text-muted);
    line-height: 1.65;
  }

  .md :global(a) {
    color: var(--accent);
    text-decoration: none;
  }

  .md :global(a:hover) {
    text-decoration: underline;
  }

  .md :global(hr) {
    border: none;
    border-top: 1px solid var(--border);
    margin: var(--space-4) 0;
  }

  .md :global(strong) {
    font-weight: 600;
  }

  /*
   * Tables: hairline rows, 12.5px, inset header, horizontal scroll retained.
   */
  .md :global(table) {
    display: block;
    width: max-content;
    max-width: 100%;
    overflow-x: auto;
    margin: var(--space-3) 0;
    border-collapse: collapse;
    font-size: 12.5px;
    line-height: 1.5;
  }

  .md :global(th),
  .md :global(td) {
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
    text-align: left;
    vertical-align: top;
  }

  .md :global(thead th) {
    background: var(--bg-inset);
    font-weight: 600;
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
