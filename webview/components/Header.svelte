<script lang="ts">
  import Icon from './Icon.svelte';

  interface Props {
    showThinking: boolean;
    /** Resolved palette currently applied to the webview root. */
    theme: 'dark' | 'light';
    onToggleTheme: () => void;
    onNewSession: () => void;
    onToggleHistory: () => void;
    onToggleRewind: () => void;
    onToggleThinking: (show: boolean) => void;
    onOpenUserConfig: () => void;
    onShowLog: () => void;
    onRestart: () => void;
    onAbout: () => void;
    /** Rewind needs a git repo; the button says so instead of failing after the click. */
    isGitRepo?: boolean;
  }

  let {
    showThinking,
    theme,
    onToggleTheme,
    onNewSession,
    onToggleHistory,
    onToggleRewind,
    onToggleThinking,
    onOpenUserConfig,
    onShowLog,
    onRestart,
    onAbout,
    isGitRepo,
  }: Props = $props();

  let menuOpen = $state(false);

  function run(action: () => void): void {
    menuOpen = false;
    action();
  }

  const themeLabel = $derived(
    theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
  );
</script>

<div class="header">
  <div class="brand">
    <span class="wordmark">◆ GROK BUILD</span>
    <span class="unofficial-tag">unofficial</span>
  </div>

  <div class="actions">
    <button class="icon-btn" title={themeLabel} onclick={onToggleTheme} aria-label={themeLabel}>
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
    </button>
    <button class="icon-btn" title="New session" onclick={onNewSession} aria-label="New session">
      <Icon name="plus" size={16} />
    </button>
    <button class="icon-btn" title="Session history" onclick={onToggleHistory} aria-label="Session history">
      <Icon name="clock" size={16} />
    </button>
    <button
      class="icon-btn"
      title={isGitRepo === false ? 'Rewind (worktrees need a git repo)' : 'Rewind to an earlier prompt'}
      onclick={onToggleRewind}
      disabled={isGitRepo === false}
      aria-label="Rewind"
    >
      <Icon name="rewind" size={16} />
    </button>
    <button
      class="icon-btn"
      title={showThinking ? 'Hide thinking' : 'Show thinking'}
      class:off={!showThinking}
      onclick={() => onToggleThinking(!showThinking)}
      aria-label="Toggle thinking"
    >
      <Icon name="sparkles" size={16} />
    </button>
    <button
      class="icon-btn"
      title="More options"
      class:active={menuOpen}
      onclick={() => (menuOpen = !menuOpen)}
      aria-label="More options"
      aria-expanded={menuOpen}
    >
      <Icon name="ellipsis" size={16} />
    </button>
  </div>

  {#if menuOpen}
    <!-- Backdrop for click dismiss -->
    <div
      class="backdrop"
      role="presentation"
      onclick={() => (menuOpen = false)}
      oncontextmenu={() => (menuOpen = false)}
    ></div>
    <div class="menu" role="menu">
      <button role="menuitem" onclick={() => run(onOpenUserConfig)}>
        <Icon name="settings" size={14} />
        <span>Open user config</span>
      </button>
      <button
        role="menuitem"
        disabled
        title="Grok manages MCP servers itself; ACP exposes no way to list or toggle them from here yet"
      >
        <Icon name="server" size={14} />
        <span>MCP servers</span>
        <span class="chip">config only</span>
      </button>
      <button
        role="menuitem"
        disabled
        title="Skill selection is a leader-only TUI feature — not reachable over ACP yet"
      >
        <Icon name="layers" size={14} />
        <span>Select skills…</span>
        <span class="chip">leader-only</span>
      </button>
      <div class="divider"></div>
      <button role="menuitem" onclick={() => run(onShowLog)}>
        <Icon name="list" size={14} />
        <span>Output log</span>
      </button>
      <button role="menuitem" class="danger" onclick={() => run(onRestart)}>
        <Icon name="restart" size={14} />
        <span>Restart agent</span>
      </button>
      <div class="divider"></div>
      <button role="menuitem" onclick={() => run(onAbout)}>
        <Icon name="sparkles" size={14} />
        <span>About</span>
      </button>
    </div>
  {/if}
</div>

<style>
  .header {
    position: relative;
    flex: 0 0 auto;
    height: 36px;
    background-color: var(--bg);
    border-bottom: 1px solid var(--border);
    padding: 0 var(--space-3);
    display: flex;
    align-items: center;
    justify-content: space-between;
    user-select: none;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }

  .wordmark {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text);
    white-space: nowrap;
  }

  .unofficial-tag {
    font-size: 10px;
    color: var(--text-faint);
    white-space: nowrap;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 2px;
    /* Six icon buttons are the header's real content; the wordmark yields to them, not the
       other way round. Without this the brand pushed the icons off and they overlapped at 280px. */
    flex: 0 0 auto;
  }

  /* Below the narrow sidebar there is no room for both; the wordmark alone still says what this is. */
  @media (max-width: 320px) {
    .unofficial-tag {
      display: none;
    }
  }

  .icon-btn {
    width: 28px;
    height: 28px;
    border-radius: var(--radius-md);
    border: none;
    background: transparent;
    color: var(--text-muted);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background-color var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard);
  }

  .icon-btn:hover,
  .icon-btn.active {
    background-color: var(--bg-hover);
    color: var(--text);
  }

  .icon-btn.off {
    opacity: 0.4;
  }

  .icon-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .icon-btn:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }

  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 19;
  }

  .menu {
    position: absolute;
    top: 100%;
    right: 8px;
    z-index: 20;
    width: 220px;
    display: flex;
    flex-direction: column;
    padding: 3px;
    background-color: var(--bg-raised);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-overlay);
  }

  .menu button {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    height: 28px;
    text-align: left;
    padding: 0 var(--space-2);
    border: none;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text);
    font-family: var(--font-ui);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
  }

  .menu button:hover:not(:disabled) {
    background-color: var(--bg-hover);
    color: var(--text);
  }

  .menu button:focus-visible {
    outline: none;
    background-color: var(--bg-hover);
    border-left: 2px solid var(--focus);
  }

  .menu button:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .menu button.danger {
    color: var(--danger);
  }

  .chip {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 1px 5px;
    border-radius: var(--radius-sm);
    background-color: var(--bg-inset);
    color: var(--text-faint);
  }

  .divider {
    height: 1px;
    margin: 3px 0;
    background-color: var(--border);
  }
</style>
