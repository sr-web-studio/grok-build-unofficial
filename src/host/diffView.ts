import * as vscode from 'vscode';
import * as path from 'node:path';

/**
 * Opens an agent edit in VS Code's own diff editor.
 *
 * The tool card only ever shows a few lines of a change; reviewing one properly means the real
 * side-by-side view, with syntax highlighting, folding and inline navigation. The "before" side
 * no longer exists on disk once the write lands, so it is served from memory through a read-only
 * virtual scheme.
 */
const SCHEME = 'grok-build-diff';

class SnapshotProvider implements vscode.TextDocumentContentProvider {
  private readonly snapshots = new Map<string, string>();
  private readonly changed = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.changed.event;

  /**
   * The last path segment is kept as the real filename so VS Code picks the right language, and
   * the segment before it disambiguates snapshots of the same file from different tool calls.
   */
  put(key: string, filePath: string, text: string): vscode.Uri {
    const uri = vscode.Uri.from({
      scheme: SCHEME,
      path: `/${encodeURIComponent(key)}/${path.basename(filePath)}`,
    });
    this.snapshots.set(uri.path, text);
    this.changed.fire(uri);
    return uri;
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.snapshots.get(uri.path) ?? '';
  }
}

const provider = new SnapshotProvider();

export function registerDiffProvider(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(SCHEME, provider));
}

export interface AgentDiff {
  /** A stable id for this edit — the tool call id, so reopening reuses the same snapshot. */
  key: string;
  path: string;
  /** `null` when the tool created the file. */
  oldText: string | null;
  newText: string;
}

export async function showAgentDiff(diff: AgentDiff): Promise<void> {
  const name = path.basename(diff.path);
  const left = provider.put(`${diff.key}~before`, diff.path, diff.oldText ?? '');

  // Prefer the file itself on the right: it is editable, and it shows the state the workspace is
  // actually in — which is the question you have after the agent has touched a file twice.
  const real = vscode.Uri.file(diff.path);
  const exists = await vscode.workspace.fs.stat(real).then(
    () => true,
    () => false,
  );
  const right = exists ? real : provider.put(`${diff.key}~after`, diff.path, diff.newText);

  const label = diff.oldText === null ? `${name} (created by Grok)` : `${name} (Grok edit)`;
  await vscode.commands.executeCommand('vscode.diff', left, right, label, { preview: true });
}
