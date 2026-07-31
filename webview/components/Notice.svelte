<script lang="ts">
  import type { NoticeBlock } from '../../src/shared/protocol';
  import Icon from './Icon.svelte';

  interface Props {
    block: NoticeBlock;
    onShowLog: () => void;
  }

  let { block, onShowLog }: Props = $props();

  /**
   * Errors get the full card treatment, so the split the design draws — headline over technical
   * detail — has to come from the one string the protocol carries. The first line is the sentence
   * the host wrote; anything after it is the wire detail (`HTTP 429 · rate_limit_exceeded …`) and
   * reads as monospace. Single-line errors simply have no detail, which is the common case.
   */
  const title = $derived(block.text.split('\n', 1)[0]);
  const detail = $derived(block.text.slice(title.length).trim());
</script>

{#if block.level === 'error'}
  <div class="card-error" role="region" aria-label="Error notice">
    <div class="card-header">
      <span class="mark-error"><Icon name="info" size={15} /></span>
      <span class="title">{title}</span>
    </div>
    {#if detail}
      <div class="detail">{detail}</div>
    {/if}
    <div class="actions">
      <button class="btn-log" onclick={onShowLog}>View log</button>
    </div>
  </div>
{:else}
  <div class="notice {block.level}">
    <span class="mark" class:warn={block.level === 'warn'}>
      <Icon name={block.level === 'warn' ? 'warning' : 'info'} size={13} />
    </span>
    <span class="text">{block.text}</span>
    {#if block.level === 'warn'}
      <button class="link-log" onclick={onShowLog}>log</button>
    {/if}
  </div>
{/if}

<style>
  .card-error {
    background-color: var(--bg-raised);
    border-left: 2px solid var(--danger);
    border-top: 1px solid var(--border);
    border-right: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .card-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .mark-error {
    color: var(--danger);
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .title {
    font-weight: 600;
    font-size: 12.5px;
    color: var(--text);
    overflow-wrap: anywhere;
  }

  .detail {
    background-color: var(--bg-inset);
    border-radius: var(--radius-md);
    padding: var(--space-2);
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--danger);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-top: 2px;
  }

  .btn-log {
    background-color: transparent;
    color: var(--text-muted);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    padding: 2px 8px;
    font-family: var(--font-ui);
    font-size: 11.5px;
    cursor: pointer;
  }

  .btn-log:hover {
    color: var(--text);
    background-color: var(--bg-hover);
  }

  .btn-log:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }

  .notice {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 0;
    border-bottom: 1px solid var(--border);
    font-size: 12px;
    color: var(--text-muted);
    gap: var(--space-2);
  }

  .mark {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    color: var(--text-faint);
  }

  .mark.warn {
    color: var(--warning);
  }

  .text {
    flex: 1 1 auto;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .link-log {
    flex: 0 0 auto;
    border: none;
    background: none;
    color: var(--accent);
    font: inherit;
    font-size: 11.5px;
    cursor: pointer;
    padding: 0;
  }

  .link-log:hover {
    text-decoration: underline;
  }

  .link-log:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }
</style>
