import * as vscode from 'vscode';
import type { ReadTextFileParams, WriteTextFileParams } from '../acp/types';

export interface FsBridgeOptions {
  readUnsavedBuffers: () => boolean;
  applyAsWorkspaceEdit: () => boolean;
}

/**
 * Serves the agent's `fs/*` callbacks through VS Code rather than raw disk I/O.
 *
 * Two things this buys us over letting grok touch the filesystem itself: the agent reads the
 * buffer the user is actually looking at (including unsaved edits), and every write lands as a
 * WorkspaceEdit so Ctrl+Z undoes the agent.
 */
export class FsBridge {
  constructor(private readonly opts: FsBridgeOptions) {}

  async readTextFile(params: ReadTextFileParams): Promise<{ content: string }> {
    const uri = vscode.Uri.file(params.path);
    let text: string;

    const open = this.opts.readUnsavedBuffers()
      ? vscode.workspace.textDocuments.find((d) => d.uri.fsPath === uri.fsPath)
      : undefined;

    if (open) {
      text = open.getText();
    } else {
      const bytes = await vscode.workspace.fs.readFile(uri);
      text = Buffer.from(bytes).toString('utf8');
    }

    return { content: slice(text, params.line ?? null, params.limit ?? null) };
  }

  /** Returns the pre-write content so the caller can show a diff. `null` = file did not exist. */
  async currentContent(filePath: string): Promise<string | null> {
    const uri = vscode.Uri.file(filePath);
    const open = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === uri.fsPath);
    if (open) return open.getText();
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      return Buffer.from(bytes).toString('utf8');
    } catch {
      return null;
    }
  }

  async writeTextFile(params: WriteTextFileParams): Promise<null> {
    const uri = vscode.Uri.file(params.path);

    if (!this.opts.applyAsWorkspaceEdit()) {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(params.content, 'utf8'));
      return null;
    }

    const existing = await this.currentContent(params.path);
    const edit = new vscode.WorkspaceEdit();

    if (existing === null) {
      edit.createFile(uri, { overwrite: false, ignoreIfExists: true, contents: Buffer.from(params.content, 'utf8') });
      const ok = await vscode.workspace.applyEdit(edit);
      if (!ok) throw new Error(`could not create ${params.path}`);
      return null;
    }

    const doc = await vscode.workspace.openTextDocument(uri);
    const full = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
    edit.replace(uri, full, params.content);
    const ok = await vscode.workspace.applyEdit(edit);
    if (!ok) throw new Error(`could not apply edit to ${params.path}`);
    // The agent's next tool call (a build, a test run) reads from disk, so the buffer cannot
    // be left dirty — but the edit above still lands in the undo stack.
    await doc.save();
    return null;
  }

  /**
   * Tool calls report a `path` for directories too (`list_directory`, `search` roots, the session
   * cwd), and `openTextDocument` on one throws "…is actually a directory". Reveal those in the
   * Explorer instead, which is what a click on a folder should have done anyway.
   */
  async reveal(filePath: string, line?: number): Promise<void> {
    const uri = vscode.Uri.file(filePath);

    const stat = await vscode.workspace.fs.stat(uri).then(
      (s) => s,
      () => undefined,
    );
    if (stat?.type === vscode.FileType.Directory) {
      await vscode.commands.executeCommand('revealInExplorer', uri);
      return;
    }

    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, { preview: true });
    if (line !== undefined && line > 0) {
      const pos = new vscode.Position(Math.max(0, line - 1), 0);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    }
  }
}

/** `line` is 1-based and inclusive; `limit` is a line count. Matches grok's read_file semantics. */
function slice(text: string, line: number | null, limit: number | null): string {
  if (line === null && limit === null) return text;
  const lines = text.split('\n');
  const start = line !== null && line > 0 ? line - 1 : 0;
  const end = limit !== null && limit > 0 ? start + limit : lines.length;
  return lines.slice(start, end).join('\n');
}
