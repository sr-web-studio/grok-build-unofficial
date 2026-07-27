import type { HostMessage, WebviewMessage } from '../src/shared/protocol';

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const api = acquireVsCodeApi();

export function send(message: WebviewMessage): void {
  api.postMessage(message);
}

/** Draft text survives the view being hidden and re-created. */
export function saveDraft(text: string): void {
  api.setState({ draft: text });
}

export function loadDraft(): string {
  const state = api.getState() as { draft?: string } | undefined;
  return state?.draft ?? '';
}

export function onHostMessage(handler: (message: HostMessage) => void): () => void {
  const listener = (event: MessageEvent<HostMessage>) => handler(event.data);
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}
