/**
 * webview 端的複習 client(ADR-075)。不 import 任何 node: 模組。
 * 預設走 Tauri 的 invoke('review', { request });給了 handler 就改走程序內。
 */
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { PROTOCOL_VERSION, parseResponseLine } from '@core/session/protocol.js';

export class ReviewError extends Error {
  readonly kind: string;

  constructor(kind: string, message: string) {
    super(message);
    this.name = 'ReviewError';
    this.kind = kind;
  }
}

export interface ReviewClient {
  start(): Promise<Record<string, unknown>>;
  next(): Promise<Record<string, unknown>>;
  submit(answer: { fill: string[] } | { apply: string }): Promise<Record<string, unknown>>;
  summary(): Promise<Record<string, unknown>>;
  status(): Promise<Record<string, unknown>>;
}

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rejectionKind(value: unknown): string {
  if (isRecord(value) && typeof value.kind === 'string' && value.kind.length > 0) return value.kind;
  return 'sidecar-unavailable';
}

export function createReviewClient(opts?: { invoke?: InvokeFn; handler?: (line: string) => Promise<string> }): ReviewClient {
  const invoke = opts?.invoke ?? tauriInvoke;
  const handler = opts?.handler;
  let nextId = 1;

  async function call(method: 'start' | 'next' | 'submit' | 'summary' | 'status', params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const id = nextId;
    nextId += 1;
    const request = { v: PROTOCOL_VERSION, id, method, params };
    let raw: unknown;
    try {
      if (handler) {
        const line = await handler(JSON.stringify(request));
        const parsed = parseResponseLine(line);
        if (!parsed.ok) throw new ReviewError('bad-response', '回覆的那一列無法使用。');
        raw = parsed.value;
      } else {
        raw = await invoke('review', { request });
      }
    } catch (err) {
      if (err instanceof ReviewError) throw err;
      const kind = rejectionKind(err);
      const message = isRecord(err) && typeof err.message === 'string' ? err.message : kind;
      throw new ReviewError(kind, message);
    }
    const line = typeof raw === 'string' ? raw : JSON.stringify(raw);
    const parsed = typeof raw === 'string' ? parseResponseLine(raw) : parseResponseLine(line);
    if (!parsed.ok || !isRecord(parsed.value)) throw new ReviewError('bad-response', '回覆的那一列無法使用。');
    const value = parsed.value;
    if (value.id !== id) throw new ReviewError('bad-response', '回覆的那一列無法使用。');
    if (value.ok === false) {
      const error = isRecord(value.error) ? value.error : {};
      const kind = typeof error.kind === 'string' && error.kind.length > 0 ? error.kind : 'internal';
      const message = typeof error.message === 'string' ? error.message : kind;
      throw new ReviewError(kind, message);
    }
    if (value.ok !== true || !isRecord(value.result)) throw new ReviewError('bad-response', '回覆的那一列無法使用。');
    return value.result;
  }

  return {
    start: () => call('start', {}),
    next: () => call('next', {}),
    submit: (answer) => call('submit', answer),
    summary: () => call('summary', {}),
    status: () => call('status', {}),
  };
}
