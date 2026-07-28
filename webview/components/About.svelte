<script lang="ts">
  import Icon from './Icon.svelte';
  import { send } from '../ipc';

  interface Props {
    agentVersion?: string;
    onClose: () => void;
  }

  let { agentVersion, onClose }: Props = $props();

  const REPO_URL = 'https://github.com/sr-web-studio/grok-build-unofficial';
</script>

<div class="panel">
  <div class="head gb-kicker">
    <span>About</span>
    <button class="x" onclick={onClose} aria-label="Close"><Icon name="close" size={13} /></button>
  </div>

  <div class="name">Grok Build UI <span class="gb-tag">Unofficial</span></div>

  <p class="body">
    A <strong>community</strong> VS Code front-end for xAI’s Grok Build CLI (Agent Client Protocol).
    <strong>Not affiliated with, endorsed by, or sponsored by xAI.</strong>
    You need a separate, authenticated Grok Build CLI install — this extension is only the chat UI.
  </p>

  <dl class="facts">
    <dt>Agent</dt>
    <dd>grok {agentVersion ?? '—'}</dd>
    <dt>CLI</dt>
    <dd>
      <button class="link" type="button" onclick={() => send({ type: 'openExternal', url: 'https://grok.x.ai/' })}>
        grok.x.ai
      </button>
    </dd>
    <dt>Repository</dt>
    <dd>
      <button class="link" type="button" onclick={() => send({ type: 'openExternal', url: REPO_URL })}>
        GitHub
      </button>
    </dd>
  </dl>
</div>

<style>
  /* Content only — the frame, background and shadow belong to the popover this sits inside. */
  .panel {
    padding: 7px 10px 10px;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--gb-dim);
    margin-bottom: 6px;
  }

  .head span {
    flex: 1 1 auto;
  }

  .name {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 800;
    font-size: 1.05em;
  }

  .body {
    margin: 5px 0 8px;
    font-size: 0.9em;
    color: var(--gb-dim);
    line-height: 1.5;
  }

  /* Label/value pairs on one line each, monospace values — the system's metadata treatment. */
  .facts {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px 10px;
    margin: 0;
    font-size: var(--gb-meta-size);
  }

  .facts dt {
    font-family: var(--gb-heading);
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--gb-dim);
  }

  .facts dd {
    margin: 0;
    min-width: 0;
    font-family: var(--gb-mono);
    overflow: hidden;
    text-overflow: ellipsis;
  }



  button.link {
    border: none;
    background: none;
    padding: 0;
    font: inherit;
    font-family: var(--gb-mono);
    color: var(--gb-accent);
    text-decoration: underline;
    cursor: pointer;
    text-align: left;
  }

  button.x {
    border: none;
    border-radius: var(--gb-radius);
    background: none;
    color: var(--gb-dim);
    display: flex;
    align-items: center;
    padding: 2px;
    cursor: pointer;
  }

  button.x:hover {
    background: var(--vscode-toolbar-hoverBackground, rgba(128, 128, 128, 0.2));
  }
</style>
