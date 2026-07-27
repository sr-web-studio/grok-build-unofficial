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
  <div class="card">
    <span class="mark"><Icon name="info" size={15} /></span>
    <div class="col">
      <div class="title">{title}</div>
      {#if detail}<div class="detail">{detail}</div>{/if}
      <div>
        <button class="link" onclick={onShowLog}>View log</button>
      </div>
    </div>
  </div>
{:else}
  <div class="notice {block.level}">
    <span class="mark">
      <Icon name={block.level === 'warn' ? 'warning' : 'info'} size={13} />
    </span>
    <span class="text">{block.text}</span>
    {#if block.level === 'warn'}
      <button class="link" onclick={onShowLog}>log</button>
    {/if}
  </div>
{/if}

<style>
  .card {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 10px 11px;
    border: 2px solid var(--gb-danger);
    border-radius: var(--gb-radius);
    background: color-mix(in srgb, var(--gb-danger) 12%, var(--gb-surface));
  }

  .col {
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
    flex: 1 1 auto;
  }

  .title {
    font-weight: 800;
    font-size: 12.5px;
    overflow-wrap: anywhere;
  }

  .detail {
    font-family: var(--gb-mono);
    font-size: var(--gb-meta-size);
    color: var(--gb-dim);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .notice {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 6px 9px;
    border-radius: var(--gb-radius);
    font-size: 0.92em;
    background: var(--gb-surface);
    border: 1px solid var(--gb-rule);
  }

  .notice.warn {
    border-color: var(--gb-warn);
  }

  .mark {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    color: var(--gb-dim);
  }

  .notice.warn .mark {
    color: var(--gb-warn);
  }

  .card .mark {
    color: var(--gb-danger);
    /* Nudge onto the title's cap height rather than its line box. */
    padding-top: 1px;
  }

  .text {
    flex: 1 1 auto;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .link {
    flex: 0 0 auto;
    border: none;
    border-radius: var(--gb-radius);
    background: none;
    color: var(--gb-accent);
    font: inherit;
    font-size: 0.9em;
    font-weight: 700;
    text-decoration: underline;
    cursor: pointer;
    padding: 0;
  }
</style>
