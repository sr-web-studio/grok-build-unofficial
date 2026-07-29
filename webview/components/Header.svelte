<script lang="ts">
  import Icon from './Icon.svelte';

  interface Props {
    showThinking: boolean;
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
</script>

<div class="header">
  <div class="row">
    <!-- The panel says what it is once, at the top. "Unofficial" is a standing disclaimer, not a
         decoration: this is a community wrapper around xAI's CLI, not an xAI product. -->
    <div class="brand">
      <span class="title gb-kicker">Grok Build UI</span>
      <span class="gb-tag">Unofficial</span>
    </div>

    <div class="tools">
      <button title="New session" onclick={onNewSession} aria-label="New session">
        <Icon name="plus" size={15} />
      </button>
      <button title="Session history" onclick={onToggleHistory} aria-label="Session history">
        <Icon name="clock" size={15} />
      </button>
      <button
        title={isGitRepo === false ? 'Rewind (worktrees need a git repo)' : 'Rewind to an earlier prompt'}
        onclick={onToggleRewind}
        aria-label="Rewind"
      >
        <Icon name="rewind" size={15} />
      </button>
      <button
        title={showThinking ? 'Hide thinking' : 'Show thinking'}
        class:off={!showThinking}
        onclick={() => onToggleThinking(!showThinking)}
        aria-label="Toggle thinking"
      >
        <Icon name="sparkles" size={15} />
      </button>
      <button
        title="More options"
        class:active={menuOpen}
        onclick={() => (menuOpen = !menuOpen)}
        aria-label="More options"
        aria-expanded={menuOpen}
      >
        <Icon name="ellipsis" size={15} />
      </button>
    </div>
  </div>

  {#if menuOpen}
    <!-- A full-frame backdrop is the cheapest dismissal that also swallows the click that raised it. -->
    <div
      class="backdrop"
      role="presentation"
      onclick={() => (menuOpen = false)}
      oncontextmenu={() => (menuOpen = false)}
    ></div>
    <div class="menu" role="menu">
      <button role="menuitem" onclick={() => run(onOpenUserConfig)}>
        <Icon name="settings" />
        <span>Open user config</span>
      </button>
      <button
        role="menuitem"
        disabled
        title="Grok manages MCP servers itself; ACP exposes no way to list or toggle them from here yet"
      >
        <Icon name="server" />
        <span>MCP servers</span>
        <span class="pill">config only</span>
      </button>
      <button
        role="menuitem"
        disabled
        title="Skill selection is a leader-only TUI feature — not reachable over ACP yet"
      >
        <Icon name="layers" />
        <span>Select skills…</span>
      </button>
      <div class="divider"></div>
      <button role="menuitem" onclick={() => run(onShowLog)}>
        <Icon name="list" />
        <span>Output log</span>
      </button>
      <button role="menuitem" class="danger" onclick={() => run(onRestart)}>
        <Icon name="restart" />
        <span>Restart agent</span>
      </button>
      <div class="divider"></div>
      <button role="menuitem" onclick={() => run(onAbout)}>
        <Icon name="sparkles" />
        <span>About</span>
      </button>
    </div>
  {/if}
</div>

<style>
  .header {
    position: relative;
    flex: 0 0 auto;
    border-bottom: 1px solid var(--gb-rule-strong);
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--gb-gap);
    /* In a 300px sidebar the dropdowns alone fill the row; let the toolbar drop below them
       instead of overflowing off the right edge where the buttons become unreachable. */
    flex-wrap: wrap;
    row-gap: 6px;
    padding: 8px 10px;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tools {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-left: auto;
  }

  .tools button {
    display: flex;
    align-items: center;
    border: none;
    background: none;
    color: var(--vscode-icon-foreground, var(--vscode-foreground));
    padding: 6px;
    border-radius: var(--gb-radius-sm);
    cursor: pointer;
  }

  .tools button:hover,
  .tools button.active {
    background: var(--vscode-toolbar-hoverBackground, rgba(128, 128, 128, 0.2));
  }

  .tools button.off {
    opacity: 0.45;
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
    background: var(--vscode-menu-background, var(--gb-surface));
    border: 1px solid var(--vscode-menu-border, var(--gb-rule-strong));
    border-radius: var(--gb-radius);
    box-shadow: var(--gb-shadow);
  }

  .menu button {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    text-align: left;
    padding: 6px 8px;
    border: none;
    border-radius: var(--gb-radius);
    background: none;
    color: var(--vscode-menu-foreground, var(--vscode-foreground));
    font: inherit;
    font-size: 0.92em;
    cursor: pointer;
  }

  .menu button:hover:not(:disabled) {
    background: var(--vscode-menu-selectionBackground, var(--vscode-list-hoverBackground));
    color: var(--vscode-menu-selectionForeground, inherit);
  }

  .menu button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .menu button.danger {
    color: var(--gb-danger);
  }

  .pill {
    margin-left: auto;
    font-family: var(--gb-mono);
    font-size: 10px;
    padding: 1px 5px;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
  }

  .divider {
    height: 1px;
    margin: 3px 0;
    background: var(--gb-rule);
  }
</style>
