import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { redact } from './redact';
import { buildAgentArgs, type SpawnOptions } from './spawn';
import {
  isNotification,
  isRequest,
  isResponse,
  type JsonRpcError,
  type JsonRpcFrame,
} from './types';

export interface AcpClientOptions extends SpawnOptions {
  cliPath: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  /** Called for every frame in both directions, already redacted. */
  onFrame?: (direction: 'in' | 'out', frame: JsonRpcFrame) => void;
  onStderr?: (chunk: string) => void;
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
  log: (line: string) => void;
}

/** Handler for a request the *agent* makes of *us*. Returning a value resolves the request. */
export type ClientRequestHandler = (method: string, params: unknown) => Promise<unknown>;
export type NotificationHandler = (method: string, params: unknown) => void;

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

export class RpcError extends Error {
  constructor(readonly rpc: JsonRpcError) {
    super(rpc.message);
    this.name = 'RpcError';
  }
}

/**
 * Line-delimited JSON-RPC 2.0 over the grok CLI's stdio. Deliberately hand-rolled: grok's
 * `_x.ai/*` methods and snake_case session updates sit outside the standard ACP SDK's types,
 * and this way there is exactly one place that knows about the transport.
 */
export class AcpClient {
  private proc: ChildProcessWithoutNullStreams | undefined;
  private nextId = 0;
  private readonly pending = new Map<number, Pending>();
  private stdoutBuf = '';
  private requestHandler: ClientRequestHandler | undefined;
  private notificationHandler: NotificationHandler | undefined;
  private exited = false;

  constructor(private readonly opts: AcpClientOptions) {}

  get running(): boolean {
    return this.proc !== undefined && !this.exited;
  }

  onRequest(handler: ClientRequestHandler): void {
    this.requestHandler = handler;
  }

  onNotification(handler: NotificationHandler): void {
    this.notificationHandler = handler;
  }

  start(): void {
    const args = buildAgentArgs(this.opts);
    this.opts.log(`spawn: ${this.opts.cliPath} ${args.join(' ')} (cwd=${this.opts.cwd})`);

    this.proc = spawn(this.opts.cliPath, args, {
      cwd: this.opts.cwd,
      env: this.opts.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      // On Windows `grok` resolves to a shim; Node refuses to exec .cmd/.bat without a shell.
      shell: process.platform === 'win32',
    }) as ChildProcessWithoutNullStreams;

    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk: string) => this.consume(chunk));

    this.proc.stderr.setEncoding('utf8');
    // stderr is human log output, never protocol — must not be parsed as frames.
    this.proc.stderr.on('data', (chunk: string) => this.opts.onStderr?.(redact(chunk)));

    this.proc.on('error', (err) => {
      this.opts.log(`spawn error: ${err.message}`);
      this.failAllPending(new Error(`Failed to start ${this.opts.cliPath}: ${err.message}`));
    });

    this.proc.on('exit', (code, signal) => {
      this.exited = true;
      this.proc = undefined;
      this.failAllPending(new Error(`grok exited (code=${code}, signal=${signal})`));
      this.opts.onExit?.(code, signal);
    });
  }

  private consume(chunk: string): void {
    this.stdoutBuf += chunk;
    let nl: number;
    while ((nl = this.stdoutBuf.indexOf('\n')) !== -1) {
      const line = this.stdoutBuf.slice(0, nl).trim();
      this.stdoutBuf = this.stdoutBuf.slice(nl + 1);
      if (!line) continue;
      let frame: JsonRpcFrame;
      try {
        frame = JSON.parse(line) as JsonRpcFrame;
      } catch {
        // grok occasionally prints a stray line to stdout; log it rather than dying.
        this.opts.log(`non-JSON stdout: ${redact(line.slice(0, 400))}`);
        continue;
      }
      this.opts.onFrame?.('in', frame);
      void this.dispatch(frame);
    }
  }

  private async dispatch(frame: JsonRpcFrame): Promise<void> {
    if (isResponse(frame)) {
      const p = this.pending.get(frame.id as number);
      if (!p) return;
      this.pending.delete(frame.id as number);
      if (frame.error) p.reject(new RpcError(frame.error));
      else p.resolve(frame.result);
      return;
    }

    if (isNotification(frame)) {
      this.notificationHandler?.(frame.method, frame.params);
      return;
    }

    if (isRequest(frame)) {
      if (!this.requestHandler) {
        this.respondError(frame.id, { code: -32601, message: `no handler for ${frame.method}` });
        return;
      }
      try {
        const result = await this.requestHandler(frame.method, frame.params);
        this.respond(frame.id, result ?? null);
      } catch (err) {
        const e = err as Error & { rpc?: JsonRpcError };
        this.respondError(frame.id, e.rpc ?? { code: -32603, message: e.message ?? String(err) });
      }
    }
  }

  /** Send a request and await its response. */
  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.proc) return Promise.reject(new Error('grok is not running'));
    const id = this.nextId++;
    const frame = { jsonrpc: '2.0' as const, id, method, params };
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.write(frame);
    });
  }

  notify(method: string, params?: unknown): void {
    if (!this.proc) return;
    this.write({ jsonrpc: '2.0', method, params });
  }

  private respond(id: number | string, result: unknown): void {
    this.write({ jsonrpc: '2.0', id, result });
  }

  private respondError(id: number | string, error: JsonRpcError): void {
    this.write({ jsonrpc: '2.0', id, error });
  }

  private write(frame: JsonRpcFrame): void {
    if (!this.proc) return;
    this.opts.onFrame?.('out', frame);
    this.proc.stdin.write(JSON.stringify(frame) + '\n');
  }

  private failAllPending(err: Error): void {
    for (const [id, p] of this.pending) {
      this.pending.delete(id);
      p.reject(err);
    }
  }

  dispose(): void {
    const proc = this.proc;
    this.proc = undefined;
    if (!proc) return;
    try {
      proc.stdin.end();
    } catch {
      // already closed
    }
    // grok backgrounds subagent/command children, so a plain kill can orphan them.
    if (process.platform === 'win32' && proc.pid !== undefined) {
      try {
        spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
        return;
      } catch {
        // fall through to the signal
      }
    }
    proc.kill();
  }
}
