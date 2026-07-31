<script lang="ts">
  import type { CommandResult } from '../../src/shared/protocol';
  import Markdown from './Markdown.svelte';
  import Icon from './Icon.svelte';

  interface Props {
    result: CommandResult;
    onClose: () => void;
  }

  let { result, onClose }: Props = $props();

  /** Title ends with … while the host is still working. */
  const pending = $derived(/…$|\.\.\.$/.test(result.title.trim()));
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions a11y_click_events_have_key_events -->
<div
  class="scrim"
  role="presentation"
  onclick={(e) => {
    if (e.target === e.currentTarget) onClose();
  }}
>
  <div
    class="modal"
    class:warn={result.kind === 'warn'}
    class:error={result.kind === 'error'}
    class:success={result.kind === 'success'}
    role="dialog"
    aria-modal="true"
    aria-label={result.title}
  >
    <div class="head">
      <span class="cmd">{result.command}</span>
      <span class="title">{result.title}</span>
      {#if pending}
        <span class="spin" aria-hidden="true"></span>
      {/if}
      <button class="x" type="button" title="Close" aria-label="Close" onclick={onClose}>
        <Icon name="close" size={13} />
      </button>
    </div>
    <div class="body">
      <Markdown text={result.body} />
    </div>
    <div class="foot">
      <button class="ok" type="button" onclick={onClose}>Done</button>
    </div>
  </div>
</div>

<style>
  /* §7.4 — shared modal shell: scrim + raised panel. */
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-4);
    background: var(--scrim);
  }

  .modal {
    width: min(100%, 420px);
    max-height: 65vh;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    background: var(--bg-raised);
    box-shadow: var(--shadow-overlay);
    overflow: hidden;
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 40px;
    padding: 0 var(--space-3);
    border-bottom: 1px solid var(--border);
    flex: 0 0 auto;
  }

  .cmd {
    flex: 0 0 auto;
    color: var(--accent);
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 500;
  }

  .title {
    flex: 1 1 auto;
    min-width: 0;
    font-weight: 600;
    font-size: 14px;
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text);
  }

  .spin {
    flex: 0 0 auto;
    width: 12px;
    height: 12px;
    border: 2px solid color-mix(in srgb, var(--accent) 30%, transparent);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: cmd-spin 0.7s linear infinite;
  }

  @keyframes cmd-spin {
    to {
      transform: rotate(360deg);
    }
  }

  .x {
    flex: 0 0 auto;
    display: flex;
    width: 24px;
    height: 24px;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-muted);
    padding: 0;
    cursor: pointer;
  }

  .x:hover {
    color: var(--text);
    background: var(--bg-hover);
  }

  .body {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    padding: var(--space-3);
    font-size: 13px;
  }

  .foot {
    display: flex;
    justify-content: flex-end;
    padding: var(--space-2) var(--space-3);
    border-top: 1px solid var(--border);
    flex: 0 0 auto;
  }

  .ok {
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    background: var(--accent);
    color: var(--accent-fg);
    font: inherit;
    font-size: 12px;
    font-weight: 500;
    padding: 5px 14px;
    cursor: pointer;
  }

  .ok:hover {
    background: var(--accent-hover);
  }
</style>
