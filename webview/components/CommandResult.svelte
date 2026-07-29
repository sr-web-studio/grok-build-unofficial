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
      <span class="cmd gb-meta">{result.command}</span>
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
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    background: color-mix(in srgb, #000 45%, transparent);
  }

  .modal {
    width: min(100%, 360px);
    max-height: min(70vh, 420px);
    display: flex;
    flex-direction: column;
    border: 1px solid var(--gb-rule-strong);
    border-left: 3px solid var(--gb-accent);
    border-radius: var(--gb-radius-lg);
    background: var(--vscode-editor-background, var(--gb-surface));
    box-shadow: var(--gb-shadow);
    overflow: hidden;
  }

  .modal.warn {
    border-left-color: var(--gb-warn);
  }

  .modal.error {
    border-left-color: var(--gb-danger);
  }

  .modal.success {
    border-left-color: var(--gb-ok);
  }

  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--gb-rule);
  }

  .cmd {
    flex: 0 0 auto;
    color: var(--gb-accent);
    font-weight: 700;
  }

  .title {
    flex: 1 1 auto;
    min-width: 0;
    font-weight: 800;
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .spin {
    flex: 0 0 auto;
    width: 12px;
    height: 12px;
    border: 2px solid color-mix(in srgb, var(--gb-accent) 30%, transparent);
    border-top-color: var(--gb-accent);
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
    border: none;
    background: none;
    color: var(--gb-dim);
    padding: 2px;
    cursor: pointer;
  }

  .x:hover {
    color: var(--vscode-foreground);
    background: var(--vscode-toolbar-hoverBackground, rgba(128, 128, 128, 0.2));
  }

  .body {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    padding: 10px 12px;
    font-size: 0.92em;
  }

  .foot {
    display: flex;
    justify-content: flex-end;
    padding: 8px 10px;
    border-top: 1px solid var(--gb-rule);
  }

  .ok {
    border: 1px solid transparent;
    border-radius: var(--gb-radius-sm);
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    font: inherit;
    font-size: 12px;
    font-weight: 700;
    padding: 5px 14px;
    cursor: pointer;
  }

  .ok:hover {
    background: var(--vscode-button-hoverBackground);
  }
</style>
