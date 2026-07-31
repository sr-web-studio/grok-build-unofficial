<script lang="ts">
  import type { AvailableCommand } from '../../src/acp/types';
  import type {
    PermissionMode,
    PromptImage,
    QueuedMessage,
    UiStatus,
  } from '../../src/shared/protocol';
  import { send } from '../ipc';
  import Icon from './Icon.svelte';

  interface Props {
    text: string;
    status: UiStatus;
    commands: AvailableCommand[];
    queuedMessages: QueuedMessage[];
    focusSignal: number;
    onCancel: () => void;
    onClearQueue: () => void;
    onPushQueue: (id?: string) => void;
    onSetModel: (modelId: string) => void;
    onSetEffort: (effort: string) => void;
    onSetPermissionMode: (mode: PermissionMode) => void;
    onRestart: () => void;
  }

  let {
    text = $bindable(),
    status,
    commands,
    queuedMessages,
    focusSignal,
    onCancel,
    onClearQueue,
    onPushQueue,
    onSetModel,
    onSetEffort,
    onSetPermissionMode,
    onRestart,
  }: Props = $props();

  const MIN_HEIGHT = 40;
  const MAX_HEIGHT = 220;
  const MAX_IMAGES = 6;

  let input = $state<HTMLTextAreaElement | null>(null);
  let fileInput = $state<HTMLInputElement | null>(null);
  let picked = $state(0);
  let attachments = $state<PromptImage[]>([]);
  let sending = $state(false);
  let sendError = $state<string | null>(null);

  const agentState = $derived(status.agentState);
  const busy = $derived(agentState === 'thinking' || agentState === 'awaitingApproval');
  const stopped = $derived(agentState === 'stopped');
  const canSubmit = $derived(
    !sending && Boolean(text.trim() || attachments.length),
  );
  const queuedCount = $derived(queuedMessages.length);

  const modes: {
    id: PermissionMode;
    label: string;
    hint: string;
    tone: 'neutral' | 'plan' | 'warn' | 'danger';
    dotClass: 'ask' | 'accept' | 'plan' | 'bypass';
  }[] = [
    {
      id: 'default',
      label: 'Ask',
      hint: 'Ask — approve every file write and every command',
      tone: 'neutral',
      dotClass: 'ask',
    },
    {
      id: 'acceptEdits',
      label: 'Accept',
      hint: 'Accept edits — writes auto-apply, commands still ask',
      tone: 'warn',
      dotClass: 'accept',
    },
    {
      id: 'plan',
      label: 'Plan',
      hint: 'Plan — read-only until you approve a plan',
      tone: 'plan',
      dotClass: 'plan',
    },
    {
      id: 'bypassPermissions',
      label: 'Bypass',
      hint: 'Bypass — no prompts; agent writes and runs freely',
      tone: 'danger',
      dotClass: 'bypass',
    },
  ];

  function optionLabel(m: (typeof modes)[number]): string {
    return m.tone === 'danger' ? `⚠ ${m.label}` : m.tone === 'warn' ? `${m.label} ⚠` : m.label;
  }

  const model = $derived(status.models.find((m) => m.modelId === status.currentModelId));
  const efforts = $derived(model?.reasoningEfforts ?? []);
  const mode = $derived(modes.find((m) => m.id === status.permissionMode) ?? modes[0]);

  const currentEffortLabel = $derived.by(() => {
    const e = status.reasoningEffort;
    if (!e) return 'Medium';
    const found = efforts.find((ef) => ef.id === e);
    if (found) {
      return found.label.replace(/\s+Effort$/i, '');
    }
    return e.charAt(0).toUpperCase() + e.slice(1).toLowerCase();
  });

  const matches = $derived.by(() => {
    const m = /^\/([\w:-]*)$/.exec(text);
    if (!m) return [];
    const prefix = m[1].toLowerCase();
    return commands.filter((c) => c.name.toLowerCase().startsWith(prefix)).slice(0, 8);
  });

  $effect(() => {
    focusSignal;
    input?.focus();
  });

  $effect(() => {
    if (picked >= matches.length) picked = 0;
  });

  function autogrow(el: HTMLTextAreaElement) {
    el.style.height = `${MIN_HEIGHT}px`;
    el.style.overflowY = 'hidden';
    const content = el.scrollHeight;
    const next = Math.max(MIN_HEIGHT, Math.min(content, MAX_HEIGHT));
    el.style.height = `${next}px`;
    el.style.overflowY = content > MAX_HEIGHT ? 'auto' : 'hidden';
  }

  $effect(() => {
    void text;
    const el = input;
    if (!el) return;
    requestAnimationFrame(() => {
      if (input === el) autogrow(el);
    });
  });

  function accept(name: string) {
    text = `/${name} `;
    picked = 0;
    input?.focus();
    if (input) autogrow(input);
  }

  async function submit() {
    if (sending) return;
    const value = text.trim();
    if (!value && attachments.length === 0) return;
    sendError = null;
    sending = true;
    const snapshot = [...attachments];
    const promptText = value || (snapshot.length ? 'Please look at the attached image(s).' : '');
    try {
      if (value && /^\/[\w:-]+(?:\s+\S[\s\S]*)?$/.test(value) && snapshot.length === 0) {
        send({ type: 'slashCommand', text: value });
        text = '';
        if (input) {
          autogrow(input);
          input.focus();
        }
        return;
      }
      const stagedIds: string[] = [];
      for (const img of snapshot) {
        const id = img.id || `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        send({
          type: 'stageImage',
          id,
          mimeType: img.mimeType || 'image/jpeg',
          data: img.data,
          preview: img.preview,
          name: img.name,
        });
        stagedIds.push(id);
      }
      send({
        type: 'prompt',
        text: promptText,
        stagedImageIds: stagedIds.length ? stagedIds : undefined,
      });
      text = '';
      attachments = [];
      if (input) {
        autogrow(input);
        input.focus();
      }
    } catch (err) {
      sendError =
        err instanceof Error
          ? err.message
          : 'Could not send (image may be too large). Try a smaller screenshot.';
    } finally {
      sending = false;
    }
  }

  function onKeydown(event: KeyboardEvent) {
    if (matches.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        picked = (picked + 1) % matches.length;
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        picked = (picked - 1 + matches.length) % matches.length;
        return;
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
        event.preventDefault();
        accept(matches[picked].name);
        return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
      return;
    }

    if (event.key === 'Escape' && busy) {
      event.preventDefault();
      onCancel();
    }
  }

  async function addFiles(files: FileList | File[]) {
    const list = [...files].filter((f) => f.type.startsWith('image/'));
    for (const file of list) {
      if (attachments.length >= MAX_IMAGES) break;
      try {
        const prepared = await prepareImage(file);
        attachments = [
          ...attachments,
          {
            id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            mimeType: prepared.mimeType,
            data: prepared.data,
            preview: prepared.preview,
            name: file.name || prepared.name,
          },
        ];
      } catch {
        const data = await readAsBase64(file);
        attachments = [
          ...attachments,
          {
            id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            mimeType: file.type || 'image/png',
            data,
            preview: data.length < 40_000 ? data : undefined,
            name: file.name,
          },
        ];
      }
    }
  }

  function readAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result ?? '');
        const comma = result.indexOf(',');
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = () => reject(reader.error ?? new Error('read failed'));
      reader.readAsDataURL(file);
    });
  }

  function prepareImage(
    file: File,
  ): Promise<{ data: string; preview: string; mimeType: string; name: string }> {
    const MAX_EDGE = 1280;
    const PREVIEW_EDGE = 96;
    const JPEG_QUALITY = 0.72;
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          let { width, height } = img;
          const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
          width = Math.max(1, Math.round(width * scale));
          height = Math.max(1, Math.round(height * scale));
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('no canvas'));
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          const mimeType = 'image/jpeg';
          const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
          const comma = dataUrl.indexOf(',');
          const data = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;

          const pScale = Math.min(1, PREVIEW_EDGE / Math.max(width, height));
          const pw = Math.max(1, Math.round(width * pScale));
          const ph = Math.max(1, Math.round(height * pScale));
          const pCanvas = document.createElement('canvas');
          pCanvas.width = pw;
          pCanvas.height = ph;
          const pCtx = pCanvas.getContext('2d');
          if (!pCtx) {
            reject(new Error('no canvas'));
            return;
          }
          pCtx.drawImage(canvas, 0, 0, pw, ph);
          const pUrl = pCanvas.toDataURL('image/jpeg', 0.7);
          const pComma = pUrl.indexOf(',');
          const preview = pComma >= 0 ? pUrl.slice(pComma + 1) : pUrl;

          resolve({
            data,
            preview,
            mimeType,
            name: file.name || 'paste.jpg',
          });
        } catch (err) {
          reject(err);
        } finally {
          URL.revokeObjectURL(url);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('image load failed'));
      };
      img.src = url;
    });
  }

  function onPaste(event: ClipboardEvent) {
    const items = event.clipboardData?.items;
    if (!items) return;
    const images: File[] = [];
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) images.push(file);
      }
    }
    if (images.length === 0) return;
    event.preventDefault();
    void addFiles(images);
  }

  function removeAttachment(id: string) {
    attachments = attachments.filter((a) => a.id !== id);
  }

  function thumb(img: PromptImage): string {
    if (img.preview) return `data:image/jpeg;base64,${img.preview}`;
    if (img.data) return `data:${img.mimeType};base64,${img.data}`;
    if (img.webviewUri) return img.webviewUri;
    return '';
  }

  function preview(t: string): string {
    const s = t.trim() || '(image)';
    return s.length > 90 ? `${s.slice(0, 87)}…` : s;
  }
</script>

<div class="composer-container">
  {#if matches.length > 0}
    <div class="autocomplete" role="listbox">
      {#each matches as command, i (command.name)}
        <button
          class="autocomplete-row"
          class:active={i === picked}
          onclick={() => accept(command.name)}
          role="option"
          aria-selected={i === picked}
        >
          <span class="autocomplete-name">/{command.name}</span>
          {#if command.description}<span class="autocomplete-desc">{command.description}</span>{/if}
        </button>
      {/each}
    </div>
  {/if}

  {#if queuedCount > 0}
    <div class="queue-banner">
      <div class="queue-head">
        <span class="queue-badge">{queuedCount}</span>
        <span class="queue-title">Waiting to send</span>
        <button class="link-btn strong" type="button" onclick={() => onPushQueue()}>Send all now</button>
        <button class="link-btn" type="button" onclick={onClearQueue}>Clear</button>
      </div>
      <ul class="queue-list">
        {#each queuedMessages as item (item.id)}
          <li class="queue-item">
            <span class="q-text" title={item.text}>{preview(item.text)}</span>
            {#if item.images?.length}
              <span class="q-meta">{item.images.length} img</span>
            {/if}
            <button class="link-btn strong tiny" type="button" onclick={() => onPushQueue(item.id)}>Send</button>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  <div class="composer-card">
    {#if attachments.length > 0}
      {@const maxShow = 4}
      {@const shown = attachments.slice(0, maxShow)}
      {@const extra = attachments.length - shown.length}
      <div class="thumbs">
        {#each shown as img (img.id)}
          <div class="thumb">
            <img src={thumb(img)} alt={img.name ?? 'attachment'} />
            <button class="rm" type="button" title="Remove" aria-label="Remove attachment" onclick={() => removeAttachment(img.id)}>
              <Icon name="close" size={10} />
            </button>
          </div>
        {/each}
        {#if extra > 0}
          <button
            class="thumb more"
            type="button"
            title="{extra} more — click to remove the oldest hidden one"
            onclick={() => {
              const hidden = attachments[maxShow];
              if (hidden) removeAttachment(hidden.id);
            }}
          >
            +{extra}
          </button>
        {/if}
      </div>
    {/if}

    <textarea
      bind:this={input}
      bind:value={text}
      rows="2"
      class="textarea"
      placeholder={busy ? 'Queue a follow-up…' : 'Ask, paste a screenshot, or / for commands…'}
      onkeydown={onKeydown}
      onpaste={onPaste}
      oninput={(e) => autogrow(e.currentTarget)}
    ></textarea>

    {#if sendError}
      <div class="send-error" role="alert">{sendError}</div>
    {/if}

    <div class="toolbar">
      <input
        bind:this={fileInput}
        type="file"
        accept="image/*"
        multiple
        class="file-input"
        onchange={(e) => {
          const files = e.currentTarget.files;
          if (files?.length) void addFiles(files);
          e.currentTarget.value = '';
        }}
      />
      <button
        class="toolbar-btn btn-attach"
        type="button"
        title="Attach image"
        aria-label="Attach image"
        onclick={() => fileInput?.click()}
      >
        <Icon name="paperclip" size={14} />
      </button>

      <!-- Permission Mode Button / Select Overlay -->
      <div class="select-wrapper mode-wrapper">
        <div class="toolbar-btn btn-mode">
          <span class="dot-perm {mode.dotClass}"></span>
          <span>{mode.label}</span>
          <span class="chevron"><Icon name="chevronDown" size={12} /></span>
        </div>
        <select
          class="select-overlay"
          title={mode.hint}
          value={status.permissionMode}
          onchange={(e) => onSetPermissionMode(e.currentTarget.value as PermissionMode)}
        >
          {#each modes as m (m.id)}
            <option value={m.id} title={m.hint}>{optionLabel(m)}</option>
          {/each}
        </select>
      </div>

      <!-- Model Select Button / Select Overlay -->
      <div class="select-wrapper model-wrapper">
        <div class="toolbar-btn btn-model">
          <span class="model-name">{model?.name ?? (stopped ? 'not started' : 'loading…')}</span>
          <span class="chevron"><Icon name="chevronDown" size={12} /></span>
        </div>
        <select
          class="select-overlay"
          title="Model"
          value={status.currentModelId ?? ''}
          onchange={(e) => onSetModel(e.currentTarget.value)}
          disabled={status.models.length === 0}
        >
          {#if status.models.length === 0}
            <option value="">{stopped ? 'not started' : 'loading…'}</option>
          {/if}
          {#each status.models as m (m.modelId)}
            <option value={m.modelId}>{m.name}</option>
          {/each}
        </select>
      </div>

      <!-- Reasoning Effort Button / Select Overlay -->
      {#if efforts.length > 0}
        <div class="select-wrapper effort-wrapper">
          <div class="toolbar-btn btn-effort">
            <span>{currentEffortLabel}</span>
            <span class="chevron"><Icon name="chevronDown" size={12} /></span>
          </div>
          <select
            class="select-overlay"
            title="Reasoning effort"
            value={status.reasoningEffort ?? ''}
            onchange={(e) => onSetEffort(e.currentTarget.value)}
          >
            {#each efforts as effort (effort.id)}
              <option value={effort.id} title={effort.description}>{effort.label}</option>
            {/each}
          </select>
        </div>
      {/if}

      <div class="spacer"></div>

      {#if stopped}
        <button class="toolbar-btn btn-restart" type="button" title="Restart the agent" onclick={onRestart}>Restart</button>
      {/if}
      {#if busy}
        <button class="toolbar-btn btn-stop" type="button" onclick={onCancel} title="Stop the current turn (Esc)">Stop</button>
      {/if}
      <button class="btn-primary" type="button" onclick={() => void submit()} disabled={!canSubmit}>
        {sending ? 'Sending…' : busy ? 'Queue' : stopped ? 'Start' : 'Send'}
      </button>
    </div>
  </div>
</div>

<style>
  .composer-container {
    flex: 0 0 auto;
    margin: 0 12px 12px 12px;
    position: relative;
    container-type: inline-size;
  }

  .composer-card {
    background-color: var(--bg-raised);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    padding: var(--space-2);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    position: relative;
  }

  .composer-card:focus-within {
    border-color: var(--focus);
    outline: 1px solid var(--focus);
    outline-offset: 0;
  }

  .textarea {
    width: 100%;
    min-height: 40px;
    max-height: 220px;
    background: transparent;
    border: none;
    color: var(--text);
    font-family: var(--font-ui);
    font-size: 13.5px;
    line-height: 1.6;
    resize: none;
    outline: none;
    padding: 0;
  }

  .textarea::placeholder {
    color: var(--text-faint);
  }

  .thumbs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }

  .thumb {
    position: relative;
    width: 36px;
    height: 36px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    overflow: hidden;
    background-color: var(--bg-inset);
    flex: 0 0 auto;
  }

  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .thumb.more {
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px dashed var(--border-strong);
    background-color: var(--bg-inset);
    color: var(--text-muted);
    font: inherit;
    font-size: 10px;
    font-weight: 600;
    cursor: pointer;
    padding: 0;
  }

  .thumb.more:hover {
    color: var(--text);
    border-color: var(--accent);
  }

  .rm {
    position: absolute;
    top: 0;
    right: 0;
    display: flex;
    padding: 0;
    border: none;
    background: var(--bg);
    color: var(--text);
    cursor: pointer;
    line-height: 1;
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease-standard);
  }

  .thumb:hover .rm,
  .rm:focus-visible {
    opacity: 1;
  }

  .send-error {
    font-size: 11.5px;
    color: var(--danger);
    padding: 2px 0;
  }

  .file-input {
    display: none;
  }

  /* Toolbar */
  .toolbar {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: nowrap;
    width: 100%;
  }

  .spacer {
    flex: 1 1 auto;
  }

  .select-wrapper {
    display: inline-flex;
    position: relative;
    flex: 0 0 auto;
  }

  .model-wrapper {
    min-width: 0;
    flex: 0 1 auto;
  }

  .select-overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
    font-size: 12px;
  }

  .toolbar-btn {
    height: 22px;
    padding: 0 6px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text-muted);
    font-family: var(--font-ui);
    font-size: 12px;
    font-weight: 500;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
    white-space: nowrap;
    flex: 0 0 auto;
  }

  .btn-attach {
    width: 24px;
    height: 22px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 24px;
  }

  .btn-model {
    min-width: 0;
    width: 100%;
    flex: 0 1 auto;
    overflow: hidden;
  }

  .model-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .toolbar-btn:hover,
  .select-wrapper:hover .toolbar-btn,
  .select-wrapper:focus-within .toolbar-btn {
    background-color: var(--bg-hover);
    color: var(--text);
  }

  .select-wrapper:focus-within .toolbar-btn,
  .toolbar-btn:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }

  .chevron {
    opacity: 0;
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    transition: opacity var(--dur-fast) var(--ease-standard);
  }

  .toolbar-btn:hover .chevron,
  .select-wrapper:hover .chevron,
  .select-wrapper:focus-within .chevron {
    opacity: 1;
  }

  .dot-perm {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .dot-perm.ask { background-color: var(--text-muted); }
  .dot-perm.accept { background-color: var(--accent); }
  .dot-perm.plan { background-color: var(--accent); }
  .dot-perm.bypass { background-color: var(--danger); }

  .btn-stop {
    border-color: var(--danger);
    color: var(--danger);
  }

  .btn-restart {
    border-color: var(--border-strong);
    color: var(--text);
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
    flex: 0 0 auto;
  }

  .btn-primary:hover {
    background-color: var(--accent-hover);
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .btn-primary:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }

  /* Responsive floor rules below 320px */
  @container (max-width: 320px) {
    .effort-wrapper {
      display: none !important;
    }
  }

  @media (max-width: 320px) {
    .effort-wrapper {
      display: none;
    }
  }

  /* Queue Banner */
  .queue-banner {
    border-left: 2px solid var(--warning);
    padding: 6px var(--space-3);
    font-size: 12px;
    color: var(--text-muted);
    background-color: var(--bg-raised);
    border-radius: var(--radius-md);
    margin-bottom: var(--space-2);
  }

  .queue-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .queue-badge {
    min-width: 1.4em;
    padding: 1px 6px;
    border-radius: var(--radius-full);
    background-color: var(--warning);
    color: var(--bg);
    font-family: var(--font-mono);
    font-weight: 600;
    font-size: 11px;
    text-align: center;
  }

  .queue-title {
    flex: 1 1 auto;
    font-weight: 600;
  }

  .queue-list {
    list-style: none;
    margin: 4px 0 0 0;
    padding: 0;
    max-height: 9em;
    overflow-y: auto;
  }

  .queue-item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 4px 0;
    border-top: 1px solid var(--border);
    font-size: 12px;
  }

  .q-text {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .q-meta {
    font-size: 11px;
    color: var(--text-faint);
  }

  .link-btn {
    background: transparent;
    border: none;
    color: var(--text-muted);
    font-family: var(--font-ui);
    font-size: 11.5px;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: var(--radius-sm);
  }

  .link-btn:hover {
    color: var(--text);
    background-color: var(--bg-hover);
  }

  .link-btn.strong {
    color: var(--accent);
  }

  .link-btn.tiny {
    font-size: 11px;
  }

  /* Autocomplete Popup */
  .autocomplete {
    position: absolute;
    bottom: 100%;
    left: 0;
    right: 0;
    margin-bottom: var(--space-2);
    background-color: var(--bg-raised);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-overlay);
    overflow: hidden;
    max-height: 240px;
    overflow-y: auto;
    z-index: 50;
  }

  .autocomplete-row {
    width: 100%;
    padding: var(--space-2) var(--space-3);
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 12px;
    border: none;
    background: transparent;
    text-align: left;
    cursor: pointer;
  }

  .autocomplete-row:hover,
  .autocomplete-row.active {
    background-color: var(--accent-subtle);
    border-left: 2px solid var(--accent);
  }

  .autocomplete-name {
    font-family: var(--font-mono);
    color: var(--text);
    font-weight: 500;
  }

  .autocomplete-desc {
    color: var(--text-muted);
  }
</style>
