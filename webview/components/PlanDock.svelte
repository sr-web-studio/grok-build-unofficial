<script lang="ts">
  import type { PlanEntry } from '../../src/acp/types';
  import Icon from './Icon.svelte';

  interface Props {
    entries: PlanEntry[];
  }

  let { entries }: Props = $props();

  /** Default collapsed — expand to see every item. */
  let open = $state(false);

  const done = $derived(entries.filter((e) => e.status === 'completed').length);
  const total = $derived(entries.length);
  const inProgress = $derived(entries.find((e) => e.status === 'in_progress')?.content);
  const summary = $derived(
    inProgress
      ? `Working: ${inProgress}`
      : done === total && total > 0
        ? 'All steps done'
        : `${done}/${total} done`,
  );
</script>

{#if total > 0}
  <!-- Floated over the transcript; does not steal flex height from the chat. -->
  <div class="float" role="region" aria-label="Plan">
    <div class="dock">
      <button class="head" type="button" onclick={() => (open = !open)} aria-expanded={open}>
        <span class="chev" class:closed={!open}><Icon name="chevron" size={12} /></span>
        <span class="gb-kicker">Plan</span>
        <span class="count gb-meta">{done}/{total}</span>
        <span class="bar"><span class="fill" style="width: {total ? (done / total) * 100 : 0}%"></span></span>
        <span class="sum" title={summary}>{summary}</span>
      </button>
      {#if open}
        <ul>
          {#each entries as entry, i (i)}
            <li class={entry.status ?? 'pending'}>
              <span class="box">
                {#if entry.status === 'completed'}
                  <Icon name="check" size={11} />
                {:else if entry.status === 'in_progress'}
                  <span class="dot"></span>
                {/if}
              </span>
              <span class="text">{entry.content}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>
{/if}

<style>
  .float {
    position: absolute;
    left: 8px;
    right: 8px;
    bottom: 8px;
    z-index: 6;
    pointer-events: none;
  }

  .dock {
    pointer-events: auto;
    border: 1px solid var(--gb-rule-strong, var(--gb-rule));
    background: color-mix(
      in srgb,
      var(--vscode-editorWidget-background, var(--vscode-sideBar-background, var(--gb-surface))) 94%,
      transparent
    );
    backdrop-filter: blur(8px);
    box-shadow: var(--gb-shadow);
  }

  .head {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    padding: 6px 9px;
    border: none;
    background: none;
    color: var(--vscode-foreground);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .head:hover {
    background: var(--vscode-list-hoverBackground);
  }

  .chev {
    display: flex;
    transition: transform 0.12s ease;
    color: var(--gb-dim);
  }

  .chev.closed {
    transform: rotate(-90deg);
  }

  .count {
    flex: 0 0 auto;
  }

  .bar {
    flex: 0 1 4em;
    height: 2px;
    background: var(--gb-rule);
    min-width: 2em;
  }

  .fill {
    display: block;
    height: 100%;
    background: var(--gb-accent);
  }

  .sum {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--gb-dim);
    font-size: 0.85em;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0 9px 8px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    border-top: 1px solid var(--gb-rule);
    max-height: 12em;
    overflow: auto;
    background: color-mix(in srgb, var(--vscode-editor-background) 40%, transparent);
  }

  li {
    display: flex;
    gap: 7px;
    align-items: flex-start;
    font-size: 0.9em;
    padding-top: 5px;
  }

  .box {
    flex: 0 0 auto;
    width: 14px;
    height: 14px;
    margin-top: 1px;
    border: 1px solid var(--gb-rule);
    border-radius: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--gb-ok);
  }

  li.completed .box {
    border-color: var(--gb-ok);
    background: color-mix(in srgb, var(--gb-ok) 18%, transparent);
  }

  li.in_progress .box {
    border-color: var(--gb-accent);
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--gb-accent);
    animation: pulse 1.2s ease-in-out infinite;
  }

  @keyframes pulse {
    50% {
      opacity: 0.35;
    }
  }

  li.completed .text {
    color: var(--gb-dim);
    text-decoration: line-through;
  }

  .text {
    flex: 1 1 auto;
    min-width: 0;
    overflow-wrap: anywhere;
  }
</style>
