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

<div class="gb-about-panel">
  <div class="gb-modal-header">
    <span class="gb-modal-title">About Grok Build</span>
    <button class="gb-icon-btn" onclick={onClose} aria-label="Close">
      <Icon name="close" size={14} />
    </button>
  </div>

  <div class="gb-modal-body">
    <div class="gb-brand-line">
      <span class="gb-wordmark">◆ GROK BUILD</span>
      <span class="gb-unofficial-tag">unofficial</span>
    </div>

    <p class="gb-disclaimer">
      A <strong>community</strong> VS Code front-end for xAI’s Grok Build CLI (Agent Client Protocol).
      <strong>Not affiliated with, endorsed by, or sponsored by xAI.</strong>
      You need a separate, authenticated Grok Build CLI install — this extension is only the chat UI.
    </p>

    <div class="gb-facts-grid">
      <div class="gb-fact-item">
        <span class="gb-fact-label">Agent version:</span>
        <span class="gb-fact-val">{agentVersion ?? '—'}</span>
      </div>
      <div class="gb-fact-item">
        <span class="gb-fact-label">CLI domain:</span>
        <span class="gb-fact-val">grok.x.ai</span>
      </div>
    </div>
  </div>

  <div class="gb-modal-footer">
    <button
      class="gb-btn-secondary"
      type="button"
      onclick={() => send({ type: 'openExternal', url: REPO_URL })}
    >
      GitHub
    </button>
    <button
      class="gb-btn-primary"
      type="button"
      onclick={() => send({ type: 'openExternal', url: 'https://grok.x.ai/' })}
    >
      grok.x.ai
    </button>
  </div>
</div>

<style>
  .gb-about-panel {
    display: flex;
    flex-direction: column;
  }

  .gb-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-3);
    border-bottom: 1px solid var(--border);
  }

  .gb-modal-title {
    font-size: 14px;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--text);
  }

  .gb-icon-btn {
    border: none;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    cursor: pointer;
    padding: 0;
  }

  .gb-icon-btn:hover {
    background-color: var(--bg-hover);
    color: var(--text);
  }

  .gb-modal-body {
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .gb-brand-line {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .gb-wordmark {
    font-family: var(--font-ui);
    font-weight: 800;
    font-size: 13.5px;
    letter-spacing: 0.08em;
    color: var(--text);
  }

  .gb-unofficial-tag {
    font-family: var(--font-ui);
    font-size: 10px;
    color: var(--text-faint);
  }

  .gb-disclaimer {
    font-size: 12.5px;
    color: var(--text-muted);
    line-height: 1.6;
    margin: 0;
  }

  .gb-facts-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    font-size: 11.5px;
    border-top: 1px solid var(--border);
    padding-top: var(--space-3);
  }

  .gb-fact-item {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .gb-fact-label {
    color: var(--text-faint);
  }

  .gb-fact-val {
    font-family: var(--font-mono);
    color: var(--text);
  }

  .gb-modal-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2);
    padding: var(--space-3);
    border-top: 1px solid var(--border);
  }





  button:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }
</style>
