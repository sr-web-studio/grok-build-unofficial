import { homedir } from 'node:os'
import { join } from 'node:path'

import * as vscode from 'vscode'

import type {
  HostMessage,
  PromptImage,
  TranscriptBlock,
  WebviewMessage,
} from '../shared/protocol'
import { GrokSession } from './session'

/**
 * The sidebar chat view.
 *
 * Everything the webview can do goes through the `WebviewMessage` union, so this file is a thin
 * router: no protocol knowledge, no transcript state.
 */
export class ChatViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'grokBuild.chat'

  private view: vscode.WebviewView | undefined
  private readonly queued: HostMessage[] = []
  private ready = false
  private readonly disposables: vscode.Disposable[] = []

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly session: GrokSession,
    private readonly showLog: () => void,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view
    this.ready = false
    for (const d of this.disposables.splice(0)) d.dispose()

    view.webview.options = {
      enableScripts: true,
      // Workspace roots so attachment files under .grok-attachments/ can load as <img src>.
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'dist'),
        vscode.Uri.joinPath(this.extensionUri, 'media'),
        ...(vscode.workspace.workspaceFolders?.map((f) => f.uri) ?? []),
      ],
    }
    view.webview.html = this.html(view.webview)

    view.webview.onDidReceiveMessage((raw: WebviewMessage) => {
      void this.handle(raw)
    })

    view.onDidDispose(() => {
      this.view = undefined
      this.ready = false
      for (const d of this.disposables.splice(0)) d.dispose()
    })

    // Theme: push resolved palette, and re-resolve when the setting or VS Code theme kind changes.
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('grokBuild.theme')) this.pushTheme()
      }),
      vscode.window.onDidChangeActiveColorTheme(() => {
        const setting = vscode.workspace
          .getConfiguration('grokBuild')
          .get<string>('theme', 'dark')
        if (setting === 'followVsCode') this.pushTheme()
      }),
    )

    // Start the agent as soon as the panel exists, rather than waiting for the first prompt.
    // Until session/new answers there is no model list, no reasoning efforts and no cwd, so an
    // unstarted panel shows an inert header and a "not started" status line — and every status
    // update raised here is queued until the frame reports `ready`, so nothing is lost by racing
    // the webview. Failures are already surfaced in the transcript by GrokSession.start().
    void this.session.ensureStarted().catch(() => undefined)
  }

  /** Resolve `grokBuild.theme` to a concrete dark/light palette (never samples VS Code colours). */
  private resolveTheme(): 'dark' | 'light' {
    const setting = vscode.workspace
      .getConfiguration('grokBuild')
      .get<'dark' | 'light' | 'followVsCode'>('theme', 'dark')
    if (setting === 'dark' || setting === 'light') return setting
    const kind = vscode.window.activeColorTheme.kind
    if (
      kind === vscode.ColorThemeKind.Light ||
      kind === vscode.ColorThemeKind.HighContrastLight
    ) {
      return 'light'
    }
    // Dark + high-contrast dark map to our dark palette (spec §6).
    return 'dark'
  }

  private pushTheme(): void {
    this.post({ type: 'theme', theme: this.resolveTheme() })
  }

  post(message: HostMessage): void {
    if (!this.view || !this.ready) {
      // Held until the webview says `ready`, otherwise early updates land in a dead frame.
      this.queued.push(message)
      return
    }
    void this.view.webview.postMessage(this.withWebviewImageUris(message))
  }

  /**
   * Turn absolute disk paths on user-message images into webview-safe URIs so <img> works after
   * we strip full base64 from the transcript payload.
   */
  private withWebviewImageUris(message: HostMessage): HostMessage {
    const webview = this.view?.webview
    if (!webview) return message

    const mapImgs = (images?: PromptImage[]): PromptImage[] | undefined => {
      if (!images?.length) return images
      return images.map((img) => {
        if (!img.path || img.preview || img.data) return img
        try {
          return {
            ...img,
            webviewUri: webview
              .asWebviewUri(vscode.Uri.file(img.path))
              .toString(),
          }
        } catch {
          return img
        }
      })
    }

    const mapBlock = (block: TranscriptBlock): TranscriptBlock => {
      if (block.kind !== 'text' || !block.images?.length) return block
      return { ...block, images: mapImgs(block.images) }
    }

    if (message.type === 'blockAdd') {
      return { ...message, block: mapBlock(message.block) }
    }
    if (message.type === 'state') {
      return {
        ...message,
        state: {
          ...message.state,
          blocks: message.state.blocks.map(mapBlock),
        },
      }
    }
    return message
  }

  async reveal(): Promise<void> {
    if (this.view) {
      this.view.show?.(true)
      return
    }
    await vscode.commands.executeCommand(`${ChatViewProvider.viewType}.focus`)
  }

  async insertText(text: string): Promise<void> {
    await this.reveal()
    this.post({ type: 'insertText', text })
    this.post({ type: 'focusInput' })
  }

  private async handle(msg: WebviewMessage): Promise<void> {
    switch (msg.type) {
      case 'ready': {
        this.ready = true
        // Full state first, then anything that arrived while the frame was loading.
        void this.view?.webview.postMessage({
          type: 'state',
          state: this.session.getState(),
        } satisfies HostMessage)
        // Theme after state so the first paint is not stuck on the CSS default if config differs.
        void this.view?.webview.postMessage({
          type: 'theme',
          theme: this.resolveTheme(),
        } satisfies HostMessage)
        const backlog = this.queued.splice(0)
        for (const m of backlog) void this.view?.webview.postMessage(m)
        return
      }
      case 'setTheme': {
        await vscode.workspace
          .getConfiguration('grokBuild')
          .update('theme', msg.theme, vscode.ConfigurationTarget.Global)
        // Config change listener also pushes; call explicitly so the UI updates even if the
        // listener is slow or the value was already the same.
        this.pushTheme()
        return
      }
      case 'stageImage':
        this.session.stageImage({
          id: msg.id,
          mimeType: msg.mimeType,
          data: msg.data,
          preview: msg.preview,
          name: msg.name,
        })
        return
      case 'prompt':
        return this.session.prompt(msg.text, msg.images, msg.stagedImageIds)
      case 'slashCommand':
        return this.session.slashCommand(msg.text)
      case 'compactContext':
        return this.session.compactContext()
      case 'refreshContext':
        return this.session.refreshContext()
      case 'interject':
        return this.session.interject(msg.text, msg.images, msg.stagedImageIds)
      case 'clearQueue':
        return this.session.clearQueue()
      case 'pushQueue':
        return this.session.pushQueue(msg.blockId)
      case 'cancel':
        return this.session.cancel()
      case 'approve':
        return this.session.answerApproval(msg.requestId, msg.decision)
      case 'planDecision':
        return this.session.answerPlan(msg.requestId, msg.approve, msg.feedback)
      case 'answerQuestion':
        return this.session.answerQuestion(msg.requestId, msg.response)
      case 'setPermissionMode':
        return this.session.setPermissionMode(msg.mode)
      case 'setModel':
        return this.session.setModel(msg.modelId)
      case 'setReasoningEffort':
        return this.session.setReasoningEffort(msg.effort)
      case 'newSession':
        return this.session.newSession()
      case 'listSessions':
        return this.session.listSessions()
      case 'loadSession':
        return this.session.loadSession(msg.sessionId)
      case 'deleteSession':
        return this.session.deleteSession(msg.sessionId)
      case 'renameSession':
        return this.session.renameSession(msg.sessionId, msg.title)
      case 'listRewindPoints':
        return this.session.listRewindPoints()
      case 'rewind':
        return this.session.rewind(msg.pointId)
      case 'worktree':
        return this.session.worktree(msg.action, msg.name)
      case 'openPath':
        return this.session.openPath(msg.path, msg.line)

      case 'openDiff':
        return this.session.openDiff(msg.blockId)
      case 'restartAgent':
        try {
          await this.session.restart()
        } catch {
          // start() already set setupHint / status for the UI
        }
        return
      case 'showLog':
        return this.showLog()
      case 'openUserConfig':
        // openPath() already turns a missing file into a transcript notice.
        return this.session.openPath(join(homedir(), '.grok', 'config.toml'))
      case 'toggleThinking':
        await vscode.workspace
          .getConfiguration('grokBuild')
          .update('showThinking', msg.show, vscode.ConfigurationTarget.Global)
        return
      case 'openExternal': {
        const raw = msg.url?.trim() ?? ''
        if (!/^https?:\/\//i.test(raw)) return
        await vscode.env.openExternal(vscode.Uri.parse(raw))
        return
      }
      default: {
        const exhaustive: never = msg
        void exhaustive
      }
    }
  }

  private html(webview: vscode.Webview): string {
    const script = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.js'),
    )
    const stylesheet = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.css'),
    )
    const nonce = nonceString()
    // Component CSS is still injected by the Svelte bundle ('unsafe-inline'); design tokens and
    // base styles load from dist/webview.css (and fonts from dist/fonts via that sheet).
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ')

    // Default data-theme before the host posts `theme` — matches grokBuild.theme default "dark".
    return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Grok Build</title>
    <link rel="stylesheet" href="${stylesheet}" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" nonce="${nonce}" src="${script}"></script>
  </body>
</html>`
  }
}

function nonceString(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  for (let i = 0; i < 32; i++)
    out += chars.charAt(Math.floor(Math.random() * chars.length))
  return out
}
