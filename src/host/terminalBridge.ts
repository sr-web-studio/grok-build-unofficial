import { spawn, type ChildProcess } from 'node:child_process'
import type {
  CreateTerminalParams,
  TerminalExitStatus,
  TerminalOutputResponse,
} from '../acp/types'

export interface TerminalBridgeOptions {
  defaultCwd: string
  outputByteLimit: () => number
  /** Live output for the tool card, so a long build isn't a frozen spinner. */
  onOutput?: (terminalId: string, chunk: string) => void
  onExit?: (terminalId: string, status: TerminalExitStatus) => void
  log: (line: string) => void
}

interface TerminalRecord {
  id: string
  command: string
  cwd: string
  proc: ChildProcess | undefined
  /** Kept as a byte-bounded tail: grok asks for the end of the output, not the start. */
  buffer: string
  truncated: boolean
  byteLimit: number
  exitStatus: TerminalExitStatus | undefined
  exitWaiters: ((status: TerminalExitStatus) => void)[]
  released: boolean
}

/**
 * Runs the agent's `terminal/*` lifecycle.
 *
 * Commands are executed by us rather than by grok, which is what makes the permission gate
 * real — nothing runs until `PermissionGate.checkCommand` (applied by the caller) says so.
 */
export class TerminalBridge {
  private readonly terminals = new Map<string, TerminalRecord>()
  private nextId = 1

  constructor(private readonly opts: TerminalBridgeOptions) {}

  create(params: CreateTerminalParams): { terminalId: string } {
    const id = `term-${this.nextId++}`
    const cwd = params.cwd ?? this.opts.defaultCwd
    // grok sends a shell command line in `command`; `args` is usually empty but honour it.
    const commandLine = [params.command, ...(params.args ?? [])].join(' ')
    const byteLimit = params.outputByteLimit ?? this.opts.outputByteLimit()

    const env: NodeJS.ProcessEnv = { ...process.env }
    for (const pair of params.env ?? []) env[pair.name] = pair.value

    this.opts.log(`terminal ${id}: ${commandLine} (cwd=${cwd})`)

    const record: TerminalRecord = {
      id,
      command: commandLine,
      cwd,
      proc: undefined,
      buffer: '',
      truncated: false,
      byteLimit,
      exitStatus: undefined,
      exitWaiters: [],
      released: false,
    }
    this.terminals.set(id, record)

    let proc: ChildProcess
    try {
      proc = spawn(commandLine, {
        cwd,
        env,
        shell: true,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (err) {
      this.finish(record, { exitCode: 127, signal: null })
      record.buffer = `failed to start command: ${(err as Error).message}`
      return { terminalId: id }
    }

    record.proc = proc
    proc.stdout?.setEncoding('utf8')
    proc.stderr?.setEncoding('utf8')
    proc.stdout?.on('data', (c: string) => this.append(record, c))
    // Merged deliberately: the agent reasons about stderr as part of the transcript.
    proc.stderr?.on('data', (c: string) => this.append(record, c))

    proc.on('error', (err) => {
      this.append(record, `\n${err.message}\n`)
      this.finish(record, { exitCode: 127, signal: null })
    })
    proc.on('exit', (code, signal) => {
      this.finish(record, { exitCode: code ?? null, signal: signal ?? null })
    })

    return { terminalId: id }
  }

  /** Records a command we refused, so the tool card still shows the agent what happened. */
  createRejected(reason: string, command: string): { terminalId: string } {
    const id = `term-${this.nextId++}`
    this.terminals.set(id, {
      id,
      command,
      cwd: this.opts.defaultCwd,
      proc: undefined,
      buffer: reason,
      truncated: false,
      byteLimit: this.opts.outputByteLimit(),
      exitStatus: { exitCode: 1, signal: null },
      exitWaiters: [],
      released: false,
    })
    return { terminalId: id }
  }

  output(terminalId: string): TerminalOutputResponse {
    const t = this.require(terminalId)
    return {
      output: t.buffer,
      truncated: t.truncated,
      exitStatus: t.exitStatus ?? null,
    }
  }

  async waitForExit(terminalId: string): Promise<TerminalExitStatus> {
    const t = this.require(terminalId)
    if (t.exitStatus) return t.exitStatus
    return new Promise<TerminalExitStatus>((resolve) =>
      t.exitWaiters.push(resolve),
    )
  }

  kill(terminalId: string): null {
    const t = this.require(terminalId)
    this.killProcess(t)
    return null
  }

  release(terminalId: string): null {
    const t = this.terminals.get(terminalId)
    if (!t) return null
    t.released = true
    this.killProcess(t)
    this.terminals.delete(terminalId)
    return null
  }

  /** Cancelling a turn must not leave a build running in the background. */
  killAll(): void {
    for (const t of this.terminals.values()) this.killProcess(t)
  }

  disposeAll(): void {
    this.killAll()
    this.terminals.clear()
  }

  private require(terminalId: string): TerminalRecord {
    const t = this.terminals.get(terminalId)
    if (!t)
      throw Object.assign(new Error(`unknown terminalId ${terminalId}`), {
        rpc: { code: -32602, message: `unknown terminalId ${terminalId}` },
      })
    return t
  }

  private killProcess(t: TerminalRecord): void {
    const proc = t.proc
    if (!proc || t.exitStatus) return
    if (process.platform === 'win32' && proc.pid !== undefined) {
      // shell:true means the real command is a child of cmd.exe — kill the tree, not the shell.
      try {
        spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        })
        return
      } catch {
        // fall through
      }
    }
    proc.kill('SIGTERM')
  }

  private append(t: TerminalRecord, chunk: string): void {
    // Strip CSI / OSC colour codes so tool cards and the agent see plain text (gh, npm, etc.).
    const clean = stripAnsi(chunk)
    if (!clean) return
    t.buffer += clean
    if (Buffer.byteLength(t.buffer, 'utf8') > t.byteLimit) {
      // Keep the tail: errors and summaries live at the end of command output.
      const buf = Buffer.from(t.buffer, 'utf8')
      t.buffer = buf.subarray(buf.length - t.byteLimit).toString('utf8')
      t.truncated = true
    }
    if (!t.released) this.opts.onOutput?.(t.id, clean)
  }

  private finish(t: TerminalRecord, status: TerminalExitStatus): void {
    if (t.exitStatus) return
    t.exitStatus = status
    t.proc = undefined
    const waiters = t.exitWaiters.splice(0)
    for (const w of waiters) w(status)
    if (!t.released) this.opts.onExit?.(t.id, status)
  }
}

/** Drop VT/ANSI escape sequences so UI and agent logs stay readable. */
export function stripAnsi(input: string): string {
  return input
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b[PX^_].*?\u001b\\/g, '')
    .replace(/\u001b./g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
}
