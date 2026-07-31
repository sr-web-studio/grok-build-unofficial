<script lang="ts">
  import type { SetupHint } from '../../src/shared/protocol';
  import Icon from './Icon.svelte';
  import { send } from '../ipc';

  interface Props {
    hint: SetupHint;
  }

  let { hint }: Props = $props();

  function openInstall() {
    if (hint.installUrl) send({ type: 'openExternal', url: hint.installUrl });
  }

  function retry() {
    send({ type: 'restartAgent' });
  }
</script>

<div class="setup" role="region" aria-label="Setup required">
  <div class="kicker-row">
    <span class="tag">unofficial</span>
    <span class="kicker">SETUP</span>
  </div>

  <h2 class="title">{hint.title}</h2>

  <p class="lead">
    This is a <strong>community</strong> VS Code front-end for xAI’s Grok Build CLI — not an official
    xAI product. It only works after the CLI is installed and signed in.
  </p>

  <pre class="detail">{hint.detail}</pre>

  <div class="actions">
    {#if hint.installUrl}
      <button class="btn-primary" type="button" onclick={openInstall}>
        Open grok.x.ai
      </button>
    {/if}
    <button class="btn-secondary" type="button" onclick={retry}>
      <Icon name="restart" size={13} />
      Retry
    </button>
    <button class="btn-ghost" type="button" onclick={() => send({ type: 'showLog' })}>
      View log
    </button>
  </div>
</div>

<style>
  .setup {
    background-color: var(--bg-raised);
    border-left: 2px solid var(--warning);
    border-top: 1px solid var(--border);
    border-right: 1px solid var(--border);
    border-bottom: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin: 10px 2px 6px;
  }

  .kicker-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .tag {
    font-size: 10px;
    color: var(--text-faint);
  }

  .kicker {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-faint);
  }

  .title {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    line-height: 1.3;
    color: var(--text);
  }

  .lead {
    margin: 0;
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--text-muted);
  }

  .lead strong {
    color: var(--text);
    font-weight: 600;
  }

  .detail {
    margin: 0;
    padding: var(--space-2) var(--space-3);
    background-color: var(--bg-inset);
    border-radius: var(--radius-md);
    font-family: var(--font-mono);
    font-size: 11.5px;
    line-height: 1.55;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--text);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
  }

  .btn-primary {
    background-color: var(--accent);
    color: var(--accent-fg);
    border: none;
    border-radius: var(--radius-md);
    padding: 0 12px;
    height: 22px;
    font-family: var(--font-ui);
    font-size: 12px;
    font-weight: 500;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background-color var(--dur-fast) var(--ease-standard);
  }

  .btn-primary:hover {
    background-color: var(--accent-hover);
  }

  .btn-primary:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }

  .btn-secondary {
    background-color: transparent;
    color: var(--text);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    padding: 0 12px;
    height: 22px;
    font-family: var(--font-ui);
    font-size: 12px;
    font-weight: 500;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
    transition: background-color var(--dur-fast) var(--ease-standard);
  }

  .btn-secondary:hover {
    background-color: var(--bg-hover);
  }

  .btn-secondary:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }

  .btn-ghost {
    background-color: transparent;
    color: var(--text-muted);
    border: none;
    border-radius: var(--radius-md);
    padding: 0 8px;
    height: 22px;
    font-family: var(--font-ui);
    font-size: 12px;
    font-weight: 500;
    display: inline-flex;
    align-items: center;
    cursor: pointer;
    transition: background-color var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard);
  }

  .btn-ghost:hover {
    color: var(--text);
    background-color: var(--bg-hover);
  }

  .btn-ghost:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }
</style>
