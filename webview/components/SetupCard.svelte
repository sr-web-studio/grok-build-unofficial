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
    <span class="gb-tag">Unofficial</span>
    <span class="kicker gb-kicker">Setup</span>
  </div>

  <h2 class="title">{hint.title}</h2>

  <p class="lead">
    This is a <strong>community</strong> VS Code front-end for xAI’s Grok Build CLI — not an official
    xAI product. It only works after the CLI is installed and signed in.
  </p>

  <pre class="detail">{hint.detail}</pre>

  <div class="actions">
    {#if hint.installUrl}
      <button class="primary" type="button" onclick={openInstall}>
        Open grok.x.ai
      </button>
    {/if}
    <button class="secondary" type="button" onclick={retry}>
      <Icon name="restart" size={13} />
      Retry
    </button>
    <button class="ghost" type="button" onclick={() => send({ type: 'showLog' })}>
      View log
    </button>
  </div>
</div>

<style>
  .setup {
    margin: 8px 2px 4px;
    padding: 14px 14px 12px;
    border: 2px solid var(--gb-rule-strong);
    border-left: 3px solid var(--gb-accent);
    background: var(--gb-surface);
  }

  .kicker-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .kicker {
    color: var(--gb-dim);
  }

  .title {
    margin: 0 0 8px;
    font-size: 1.05em;
    font-weight: 800;
    line-height: 1.3;
  }

  .lead {
    margin: 0 0 10px;
    font-size: 0.9em;
    line-height: 1.5;
    color: var(--gb-dim);
  }

  .lead strong {
    color: var(--vscode-foreground);
    font-weight: 700;
  }

  .detail {
    margin: 0 0 12px;
    padding: 8px 10px;
    border-left: 2px solid var(--gb-rule);
    background: var(--gb-surface-sunken);
    font-family: var(--gb-mono);
    font-size: 11.5px;
    line-height: 1.55;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--vscode-foreground);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }

  button {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font: inherit;
    font-size: 12px;
    font-weight: 700;
    padding: 5px 12px;
    border-radius: var(--gb-radius);
    cursor: pointer;
  }

  .primary {
    border: 1px solid transparent;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }

  .primary:hover {
    background: var(--vscode-button-hoverBackground);
  }

  .secondary {
    border: 1px solid var(--gb-accent);
    background: color-mix(in srgb, var(--gb-accent) 14%, transparent);
    color: var(--vscode-foreground);
  }

  .ghost {
    border: 1px solid transparent;
    background: none;
    color: var(--gb-accent);
    text-decoration: underline;
    padding-left: 6px;
    padding-right: 6px;
  }
</style>
