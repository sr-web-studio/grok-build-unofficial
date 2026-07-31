<script lang="ts">
  import type { PlanEntry } from '../../src/acp/types';
  import Icon from './Icon.svelte';

  interface Props {
    entries: PlanEntry[];
  }

  let { entries }: Props = $props();

  /** Default collapsed — expand upward into reserved max height, not over the transcript. */
  let open = $state(false);

  const done = $derived(entries.filter((e) => e.status === 'completed').length);
  const total = $derived(entries.length);
  const inProgress = $derived(entries.find((e) => e.status === 'in_progress')?.content);
  const summary = $derived(
    inProgress
      ? inProgress
      : done === total && total > 0
        ? 'All steps done'
        : `${done}/${total} done`,
  );
</script>

{#if total > 0}
  <div class="dock" role="region" aria-label="Plan">
    <button class="dock-header" type="button" onclick={() => (open = !open)} aria-expanded={open}>
      <div class="dock-title">
        <span class="chev" class:closed={!open}><Icon name="chevron" size={12} /></span>
        <span class="kicker">PLAN</span>
        <span class="count">{done}/{total}</span>
        <div class="meter">
          <div class="fill" class:complete={done === total} style="width: {total ? (done / total) * 100 : 0}%;"></div>
        </div>
      </div>
      <span class="step-summary" title={summary}>{summary}</span>
    </button>
    {#if open}
      <div class="dock-items" role="list">
        {#each entries as entry, i (i)}
          <!-- A plan row is read-only status, not a control: no tabindex, or the whole dock
               becomes a tab stop per entry with nothing to activate. -->
          <div class="dock-item" class:done={entry.status === 'completed'} role="listitem">
            {#if entry.status === 'completed'}
              <span class="icon-done"><Icon name="check" size={11} /></span>
            {:else if entry.status === 'in_progress'}
              <span class="icon-active"></span>
            {:else}
              <span class="icon-pending"></span>
            {/if}
            <span class="item-text">{entry.content}</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .dock {
    flex: 0 0 auto;
    margin: 0 12px 8px 12px;
    background-color: var(--bg-raised);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    padding: var(--space-2) var(--space-3);
  }

  .dock-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    border: none;
    background: transparent;
    font-family: var(--font-ui);
    font-size: 11.5px;
    color: var(--text-muted);
    cursor: pointer;
    user-select: none;
    padding: 0;
  }

  .dock-header:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
    border-radius: var(--radius-sm);
  }

  .dock-title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .chev {
    display: flex;
    align-items: center;
    color: var(--text-faint);
    transition: transform var(--dur-fast) var(--ease-standard);
  }

  .chev.closed {
    transform: rotate(-90deg);
  }

  .kicker {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-faint);
  }

  .count {
    color: var(--text-muted);
  }

  .meter {
    width: 48px;
    height: 3px;
    background-color: var(--border);
    border-radius: var(--radius-full);
    overflow: hidden;
  }

  .fill {
    height: 100%;
    background-color: var(--accent);
  }

  .fill.complete {
    background-color: var(--success);
  }

  .step-summary {
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 180px;
  }

  .dock-items {
    margin-top: var(--space-2);
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-top: var(--space-2);
    border-top: 1px solid var(--border);
    max-height: 10em;
    overflow-y: auto;
  }

  .dock-item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: 12.5px;
    color: var(--text);
    padding: 2px 4px;
    border-radius: var(--radius-sm);
    border-left: 2px solid transparent;
  }

  .dock-item:focus-visible {
    outline: none;
    background-color: var(--bg-hover);
    border-left: 2px solid var(--focus);
  }

  .dock-item.done {
    color: var(--text-faint);
    text-decoration: line-through;
  }

  .icon-done {
    color: var(--success);
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .icon-active {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background-color: var(--accent);
    animation: pulse 1.5s infinite ease-in-out;
    flex-shrink: 0;
  }

  @keyframes pulse {
    0% { opacity: 0.4; transform: scale(0.9); }
    50% { opacity: 1; transform: scale(1.1); }
    100% { opacity: 0.4; transform: scale(0.9); }
  }

  .icon-pending {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 1px solid var(--border-strong);
    flex-shrink: 0;
  }

  .item-text {
    flex: 1 1 auto;
    min-width: 0;
    overflow-wrap: anywhere;
  }
</style>
