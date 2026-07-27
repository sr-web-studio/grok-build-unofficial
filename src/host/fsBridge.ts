import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import * as vscode from 'vscode'
import type { ReadTextFileParams, WriteTextFileParams } from '../acp/types'

export interface FsBridgeOptions {
  readUnsavedBuffers: () => boolean
  applyAsWorkspaceEdit: () => boolean
}

/** Soft cap so a huge photo does not blow the model context when we inline base64. */
const MAX_INLINE_BASE64_BYTES = 1_500_000

const IMAGE_EXT = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.tif',
  '.tiff',
  '.ico',
  '.svg',
  '.heic',
  '.avif',
])

const BINARY_DOC_EXT = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.zip',
  '.gz',
  '.7z',
  '.rar',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.wasm',
  '.mp3',
  '.mp4',
  '.mov',
  '.wav',
  '.webm',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
])

/**
 * Serves the agent's `fs/*` callbacks through VS Code rather than raw disk I/O.
 *
 * Cloud mounts (Google Drive `G:\My Drive\…`, OneDrive) often fail on the first open while
 * Windows hydrates a placeholder file — we retry, fall back to Node fs, and surface a clear error
 * instead of a bare EPERM/ENOENT that the model then thrashing-retries.
 */
export class FsBridge {
  constructor(private readonly opts: FsBridgeOptions) {}

  async readTextFile(params: ReadTextFileParams): Promise<{ content: string }> {
    const filePath = normalizeFsPath(params.path)
    const uri = vscode.Uri.file(filePath)
    const ext = path.extname(filePath).toLowerCase()

    // Open editor buffers are always text — prefer them for unsaved work.
    const open = this.opts.readUnsavedBuffers()
      ? vscode.workspace.textDocuments.find((d) =>
          pathsEqual(d.uri.fsPath, filePath),
        )
      : undefined

    if (open) {
      return {
        content: slice(
          open.getText(),
          params.line ?? null,
          params.limit ?? null,
        ),
      }
    }

    const bytes = await readBytesWithRetry(filePath, uri)

    if (isBinaryBytes(bytes) || IMAGE_EXT.has(ext) || BINARY_DOC_EXT.has(ext)) {
      return { content: describeBinary(filePath, ext, Buffer.from(bytes)) }
    }

    const text = Buffer.from(bytes).toString('utf8')
    if (text.includes('\u0000')) {
      return { content: describeBinary(filePath, ext, Buffer.from(bytes)) }
    }

    return { content: slice(text, params.line ?? null, params.limit ?? null) }
  }

  /** Returns the pre-write content so the caller can show a diff. `null` = file did not exist. */
  async currentContent(filePath: string): Promise<string | null> {
    const normalized = normalizeFsPath(filePath)
    const uri = vscode.Uri.file(normalized)
    const open = vscode.workspace.textDocuments.find((d) =>
      pathsEqual(d.uri.fsPath, normalized),
    )
    if (open) return open.getText()
    try {
      const bytes = await readBytesWithRetry(normalized, uri)
      if (isBinaryBytes(bytes)) return null
      const text = Buffer.from(bytes).toString('utf8')
      if (text.includes('\u0000')) return null
      return text
    } catch {
      return null
    }
  }

  async writeTextFile(params: WriteTextFileParams): Promise<null> {
    const filePath = normalizeFsPath(params.path)
    const uri = vscode.Uri.file(filePath)
    const payload = Buffer.from(params.content, 'utf8')

    // Cloud drives often reject WorkspaceEdit / document save; prefer direct write there.
    const preferDirect =
      !this.opts.applyAsWorkspaceEdit() || isCloudPath(filePath)

    if (preferDirect) {
      await writeBytesWithRetry(filePath, uri, payload)
      return null
    }

    try {
      const existing = await this.currentContent(filePath)
      const edit = new vscode.WorkspaceEdit()

      if (existing === null) {
        edit.createFile(uri, {
          overwrite: false,
          ignoreIfExists: true,
          contents: payload,
        })
        const ok = await vscode.workspace.applyEdit(edit)
        if (!ok) throw new Error(`could not create ${filePath}`)
        return null
      }

      const doc = await vscode.workspace.openTextDocument(uri)
      const full = new vscode.Range(
        doc.positionAt(0),
        doc.positionAt(doc.getText().length),
      )
      edit.replace(uri, full, params.content)
      const ok = await vscode.workspace.applyEdit(edit)
      if (!ok) throw new Error(`could not apply edit to ${filePath}`)
      await doc.save()
      return null
    } catch (err) {
      // Last resort on flaky cloud / locked files — write straight through.
      try {
        await writeBytesWithRetry(filePath, uri, payload)
        return null
      } catch {
        throw new Error(friendlyIoError(filePath, err))
      }
    }
  }

  /**
   * Tool calls report a `path` for directories too (`list_directory`, `search` roots, the session
   * cwd), and `openTextDocument` on one throws "…is actually a directory". Reveal those in the
   * Explorer instead, which is what a click on a folder should have done anyway.
   */
  async reveal(filePath: string, line?: number): Promise<void> {
    const normalized = normalizeFsPath(filePath)
    const uri = vscode.Uri.file(normalized)

    const stat = await vscode.workspace.fs.stat(uri).then(
      (s) => s,
      () => undefined,
    )
    if (stat?.type === vscode.FileType.Directory) {
      await vscode.commands.executeCommand('revealInExplorer', uri)
      return
    }

    const ext = path.extname(normalized).toLowerCase()
    if (IMAGE_EXT.has(ext) || BINARY_DOC_EXT.has(ext)) {
      await vscode.commands.executeCommand('vscode.open', uri)
      return
    }

    try {
      const doc = await vscode.workspace.openTextDocument(uri)
      const editor = await vscode.window.showTextDocument(doc, {
        preview: true,
      })
      if (line !== undefined && line > 0) {
        const pos = new vscode.Position(Math.max(0, line - 1), 0)
        editor.selection = new vscode.Selection(pos, pos)
        editor.revealRange(
          new vscode.Range(pos, pos),
          vscode.TextEditorRevealType.InCenter,
        )
      }
    } catch {
      await vscode.commands.executeCommand('vscode.open', uri)
    }
  }
}

// ---------------------------------------------------------------- path / cloud helpers

/** True for Google Drive, OneDrive, Dropbox-style mounts that hydrate on demand. */
export function isCloudPath(p: string): boolean {
  const n = p.replace(/\//g, '\\').toLowerCase()
  if (/^[g]:\\/.test(n)) return true // common Google Drive letter
  if (n.includes('\\my drive\\') || n.includes('\\google drive\\')) return true
  if (n.includes('\\onedrive\\') || n.includes('\\dropbox\\')) return true
  if (n.includes('\\.shortcut-targets-by-id\\')) return true // Drive for desktop shared
  return false
}

/** Short session tip (info, not a hard failure). */
export function cloudDriveHint(cwd: string): string | undefined {
  if (!isCloudPath(cwd)) return undefined
  return (
    'Tip: workspace is on a cloud drive (e.g. Google Drive). Online-only files can make tools flaky until synced. ' +
    'If a Read/Edit fails, the tool error will suggest alternatives — no need to panic.'
  )
}

/**
 * Agent-facing recovery hint after a tool I/O failure on cloud paths.
 * Returned as part of the tool error so the model can change strategy on the next turn.
 */
export function agentCloudToolHint(filePathOrCwd: string): string {
  return [
    'CLOUD_PATH_HINT: this path appears to be on Google Drive / OneDrive / similar cloud storage.',
    'The failure is often a streamed (online-only) file, not a bad path.',
    'What you should try next (pick one, do not tight-loop the same call):',
    '1) Wait briefly and retry the tool once.',
    '2) Ask the user to right-click the folder → "Always keep on this device" (or copy the project to a local disk like C:/E:).',
    '3) For images/PDFs/screenshots: ask the user to paste/attach in chat instead of Read.',
    '4) For shell: always quote paths with spaces, e.g. cd "G:\\My Drive\\project".',
    `path: ${filePathOrCwd}`,
  ].join('\n')
}

function normalizeFsPath(p: string): string {
  // Agents sometimes send file:// URIs or mixed separators.
  let s = p.trim()
  if (s.startsWith('file:')) {
    try {
      s = vscode.Uri.parse(s).fsPath
    } catch {
      s = s.replace(/^file:\/\//i, '')
      if (/^\/[A-Za-z]:/.test(s)) s = s.slice(1)
    }
  }
  // Decode %20 etc. if the agent double-encoded the path.
  try {
    if (s.includes('%')) s = decodeURIComponent(s)
  } catch {
    // keep raw
  }
  return path.normalize(s)
}

function pathsEqual(a: string, b: string): boolean {
  return path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function isTransientIoError(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err).toLowerCase()
  const code = String((err as NodeJS.ErrnoException)?.code ?? '').toLowerCase()
  return (
    code === 'ebusy' ||
    code === 'eagain' ||
    code === 'eacces' ||
    code === 'eperm' ||
    code === 'unknown' ||
    msg.includes('ebusy') ||
    msg.includes('eagain') ||
    msg.includes('eperm') ||
    msg.includes('eacces') ||
    msg.includes('resource busy') ||
    msg.includes('cannot access') ||
    msg.includes('being used') ||
    msg.includes('cloud') ||
    msg.includes('placeholder') ||
    msg.includes('not available') ||
    msg.includes('network') ||
    msg.includes('timed out') ||
    msg.includes('timeout')
  )
}

function friendlyIoError(filePath: string, err: unknown): string {
  const raw = (err as Error)?.message ?? String(err)
  const parts = [
    `Tool I/O soft-failure (not necessarily fatal): could not access ${filePath}: ${raw}`,
  ]
  if (isCloudPath(filePath)) {
    parts.push('', agentCloudToolHint(filePath))
  } else {
    parts.push(
      'If this keeps failing, check the path exists and is not locked by another app; then try a different approach or ask the user.',
    )
  }
  return parts.join('\n')
}

async function readBytesWithRetry(
  filePath: string,
  uri: vscode.Uri,
): Promise<Uint8Array> {
  let lastErr: unknown
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      // Prefer VS Code FS (respects remote / virtual workspaces), then Node for flaky cloud.
      try {
        return await vscode.workspace.fs.readFile(uri)
      } catch (vsErr) {
        lastErr = vsErr
        return await fsp.readFile(filePath)
      }
    } catch (err) {
      lastErr = err
      if (attempt < 4 && isTransientIoError(err)) {
        // Hydrate cloud placeholders: open+close with increasing backoff.
        await sleep(150 * (attempt + 1) * (attempt + 1))
        continue
      }
      break
    }
  }
  throw new Error(friendlyIoError(filePath, lastErr))
}

async function writeBytesWithRetry(
  filePath: string,
  uri: vscode.Uri,
  payload: Buffer,
): Promise<void> {
  // Ensure parent dir exists (cloud create can race).
  try {
    await fsp.mkdir(path.dirname(filePath), { recursive: true })
  } catch {
    // ignore — write will surface a better error
  }

  let lastErr: unknown
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      try {
        await vscode.workspace.fs.writeFile(uri, payload)
        return
      } catch (vsErr) {
        lastErr = vsErr
        await fsp.writeFile(filePath, payload)
        return
      }
    } catch (err) {
      lastErr = err
      if (attempt < 4 && isTransientIoError(err)) {
        await sleep(150 * (attempt + 1) * (attempt + 1))
        continue
      }
      break
    }
  }
  throw new Error(friendlyIoError(filePath, lastErr))
}

// ---------------------------------------------------------------- content helpers

/** `line` is 1-based and inclusive; `limit` is a line count. Matches grok's read_file semantics. */
function slice(
  text: string,
  line: number | null,
  limit: number | null,
): string {
  if (line === null && limit === null) return text
  const lines = text.split('\n')
  const start = line !== null && line > 0 ? line - 1 : 0
  const end = limit !== null && limit > 0 ? start + limit : lines.length
  return lines.slice(start, end).join('\n')
}

function isBinaryBytes(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8000)
  if (n === 0) return false
  let suspicious = 0
  for (let i = 0; i < n; i++) {
    const b = bytes[i]
    if (b === 0) return true
    if (b < 7 || (b > 13 && b < 32)) suspicious += 1
  }
  return suspicious / n > 0.1
}

function mimeForExt(ext: string): string {
  switch (ext) {
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    case '.svg':
      return 'image/svg+xml'
    case '.bmp':
      return 'image/bmp'
    case '.pdf':
      return 'application/pdf'
    default:
      return 'application/octet-stream'
  }
}

function describeBinary(filePath: string, ext: string, buf: Buffer): string {
  const mime = mimeForExt(ext)
  const name = path.basename(filePath)
  const lines = [
    `[Binary file — not plain text]`,
    `name: ${name}`,
    `path: ${filePath}`,
    `mime: ${mime}`,
    `size: ${buf.length} bytes`,
  ]

  if (buf.length === 0 && isCloudPath(filePath)) {
    lines.push(
      '',
      'File is 0 bytes — often an unhydrated cloud placeholder (not a hard project error).',
      agentCloudToolHint(filePath),
    )
  }

  if (IMAGE_EXT.has(ext)) {
    lines.push(
      '',
      'This is an image (binary). Prefer user chat attach/paste if vision Read is unreliable.',
      'If base64 is embedded below, you may describe it; otherwise ask the user to attach it in chat.',
    )
    if (buf.length > 0 && buf.length <= MAX_INLINE_BASE64_BYTES) {
      lines.push('', `data:${mime};base64,${buf.toString('base64')}`)
    } else if (buf.length > MAX_INLINE_BASE64_BYTES) {
      lines.push(
        '',
        `Image is too large to inline (${buf.length} bytes). Open it in the editor or have the user re-attach a compressed copy in chat.`,
      )
    }
  } else if (ext === '.pdf') {
    lines.push(
      '',
      'This is a PDF. The client cannot extract pages as text here.',
      'Ask the user to paste the relevant pages as images, or export text, then re-send.',
    )
  } else {
    lines.push(
      '',
      'Binary content is not available as UTF-8 text through this read.',
    )
  }

  return lines.join('\n')
}
