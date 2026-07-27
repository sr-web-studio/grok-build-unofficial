<script lang="ts">
  import { renderMarkdown } from '../markdown';

  interface Props {
    text: string;
  }

  let { text }: Props = $props();

  // renderMarkdown escapes everything before adding markup, so {@html} is safe here.
  const html = $derived(renderMarkdown(text));
</script>

<div class="md">{@html html}</div>

<style>
  .md {
    line-height: 1.5;
    overflow-wrap: anywhere;
  }

  .md :global(p) {
    margin: 0 0 0.6em;
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
    margin: 0.9em 0 0.4em;
    font-size: 1em;
    /* The system's headings are heavy and tight, not merely semibold. */
    font-weight: 800;
    letter-spacing: -0.01em;
  }

  .md :global(h1) {
    font-size: 1.15em;
  }

  .md :global(h2) {
    font-size: 1.08em;
  }

  .md :global(ul),
  .md :global(ol) {
    margin: 0 0 0.6em;
    padding-left: 1.35em;
  }

  .md :global(li) {
    margin: 0.15em 0;
  }

  .md :global(code) {
    font-family: var(--gb-mono);
    font-size: 0.92em;
    background: var(--gb-surface-sunken);
    border-radius: var(--gb-radius);
    padding: 0.1em 0.3em;
  }

  .md :global(pre.md-code) {
    margin: 0.5em 0;
    padding: 8px 9px;
    background: var(--gb-surface-sunken);
    border: 1px solid var(--gb-rule);
    border-radius: var(--gb-radius);
  }

  .md :global(pre.md-code code) {
    background: none;
    padding: 0;
    font-size: 0.9em;
    line-height: 1.45;
    /* Same reasoning as the diff rows: sideways scrolling inside a narrow sidebar hides code
       instead of presenting it. pre-wrap keeps indentation, anywhere breaks unbreakable tokens. */
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .md :global(blockquote) {
    margin: 0.5em 0;
    padding-left: 9px;
    border-left: 2px solid var(--vscode-textBlockQuote-border, var(--gb-rule));
    color: var(--gb-dim);
  }

  .md :global(a) {
    color: var(--gb-accent);
  }

  /* A rule in the body is a section break, so it carries the system's 2px weight. */
  .md :global(hr) {
    border: none;
    border-top: 2px solid var(--gb-rule);
    margin: 0.8em 0;
  }

  .md :global(strong) {
    font-weight: 700;
  }

  /*
   * A table in a 300px sidebar cannot be made to fit, so it is allowed to scroll sideways inside
   * its own box rather than stretching the transcript. The header row carries the system's
   * uppercase weight; the rules are hairlines so a wide table does not read as a grid of boxes.
   */
  .md :global(table) {
    display: block;
    width: max-content;
    max-width: 100%;
    overflow-x: auto;
    margin: 0.6em 0;
    border: 1px solid var(--gb-rule);
    border-radius: var(--gb-radius);
    border-collapse: collapse;
    font-size: 0.95em;
  }

  .md :global(th),
  .md :global(td) {
    padding: 4px 8px;
    border-bottom: 1px solid var(--gb-rule);
    text-align: left;
    vertical-align: top;
    /* Cells wrap only where they must — a table reads badly one word per line. */
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
</style>
