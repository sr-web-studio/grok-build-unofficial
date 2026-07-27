import * as vscode from 'vscode'

import { redact } from './acp/redact'
import { registerDiffProvider } from './host/diffView'
import { ChatViewProvider } from './host/panel'
import { GrokSession } from './host/session'

export function activate(context: vscode.ExtensionContext): void {
  const channel = vscode.window.createOutputChannel('Grok Build')
  context.subscriptions.push(channel)

  registerDiffProvider(context)

  // Everything written here can contain command lines and env values, so redact unconditionally.
  const log = (line: string) =>
    channel.appendLine(`${timestamp()} ${redact(line)}`)

  const cwd =
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ??
    process.env.USERPROFILE ??
    process.cwd()

  let provider: ChatViewProvider | undefined
  const lastSessionKey = `grokBuild.lastSessionId:${cwd}`
  const session = new GrokSession({
    cwd,
    post: (msg) => provider?.post(msg),
    log,
    getLastSessionId: () => context.workspaceState.get<string>(lastSessionKey),
    setLastSessionId: (id) => {
      void context.workspaceState.update(lastSessionKey, id)
    },
  })
  context.subscriptions.push(session)

  provider = new ChatViewProvider(context.extensionUri, session, () =>
    channel.show(true),
  )
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ChatViewProvider.viewType,
      provider,
      {
        // The transcript lives in the host, but keeping the DOM avoids a reflow on every tab switch.
        webviewOptions: { retainContextWhenHidden: true },
      },
    ),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('grokBuild.focusChat', async () => {
      await provider?.reveal()
      provider?.post({ type: 'focusInput' })
    }),

    vscode.commands.registerCommand('grokBuild.newSession', async () => {
      await provider?.reveal()
      await session.newSession()
    }),

    vscode.commands.registerCommand('grokBuild.restartAgent', async () => {
      try {
        await session.restart()
      } catch {
        channel.show(true)
      }
    }),

    vscode.commands.registerCommand('grokBuild.showLog', () =>
      channel.show(true),
    ),

    vscode.commands.registerCommand(
      'grokBuild.addSelectionToChat',
      async () => {
        const editor = vscode.window.activeTextEditor
        if (!editor) return
        const selection = editor.selection
        const text = editor.document.getText(
          selection.isEmpty ? undefined : selection,
        )
        if (!text.trim()) return
        const rel = vscode.workspace.asRelativePath(editor.document.uri)
        const lines = selection.isEmpty
          ? ''
          : `:${selection.start.line + 1}-${selection.end.line + 1}`
        const lang = editor.document.languageId
        await provider?.insertText(
          `\`${rel}${lines}\`\n\`\`\`${lang}\n${text}\n\`\`\`\n`,
        )
      },
    ),
  )

  log(`activated (cwd=${cwd})`)
}

export function deactivate(): void {
  // The session is disposed through context.subscriptions.
}

function timestamp(): string {
  return new Date().toISOString().slice(11, 23)
}
