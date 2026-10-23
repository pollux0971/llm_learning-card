/**
 * webview 端的複習 client(ADR-075、ADR-078)。不 import 任何 node: 模組。
 * 預設走 Tauri 的 invoke('review', { request });給了 handler 就改走程序內。
 * 兩個視窗共用這一條:`busy` 只在這裡重試,錯誤字樣只從 ERROR_MESSAGES 查。
 */
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { ERROR_MESSAGES, PROTOCOL_VERSION, parseResponseLine } from '@core/session/protocol.js';

/** 跟 ADR-077 D5 一樣,位置搬到共用 client。BUSY_GIVE_UP_MS 要跟 Rust 的 REQUEST_TIMEOUT 一樣。 */
export const BUSY_RETRY_MS = 300;
export const BUSY_NOTICE_AFTER_MS = 1000;
export const BUSY_GIVE_UP_MS = 180_000;

export class ReviewError extends Error {
  readonly kind: string;
  readonly unsent: boolean;

  constructor(kind: string, message: string, unsent = false) {
    super(message);
    this.name = 'ReviewError';
    this.kind = kind;
    this.unsent = unsent;
  }
}

export interface ReviewClient {
  start(): Promise<Record<string, unknown>>;
  next(): Promise<Record<string, unknown>>;
  submit(answer: { fill: string[] } | { apply: string }): Promise<Record<string, unknown>>;
  summary(): Promise<Record<string, unknown>>;
  status(): Promise<Record<string, unknown>>;
  teachOpen(category?: string): Promise<Record<string, unknown>>;
  teachNext(): Promise<Record<string, unknown>>;
  teachSwitch(category: string): Promise<Record<string, unknown>>;
  teachPrereq(index: number): Promise<Record<string, unknown>>;
  teachDeepen(): Promise<Record<string, unknown>>;
  teachPoll(): Promise<Record<string, unknown>>;
  teachCancel(): Promise<Record<string, unknown>>;
  teachBack(): Promise<Record<string, unknown>>;
  onWait(listener: (waiting: boolean) => void): () => void;
}

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
type Method =
  | 'start'
  | 'next'
  | 'submit'
  | 'summary'
  | 'status'
  | 'teach.open'
  | 'teach.next'
  | 'teach.switch'
  | 'teach.prereq'
  | 'teach.deepen'
  | 'teach.poll'
  | 'teach.cancel'
  | 'teach.back';

/** Rust 那七種:進出錯畫面。其餘側車錯誤留在卡片上(ADR-079)。判斷放這裡,視窗不出現 busy 字面。 */
const CLIENT_LAYER_KINDS = ['not-configured', 'sidecar-unavailable', 'sidecar-exited', 'timeout', 'busy', 'bad-envelope', 'bad-response'] as const;

export function isClientLayerError(err: unknown): boolean {
  if (!(err instanceof ReviewError)) return true;
  return (CLIENT_LAYER_KINDS as readonly string[]).includes(err.kind);
}

/**
 * 深入的錯誤字樣。credential-unavailable 用側車給的那句(深入版樣板);
 * 其他 kind 查 ERROR_MESSAGES,不用例外原文。
 */
export function deepenErrorText(err: unknown): string {
  if (err instanceof ReviewError && err.kind === 'credential-unavailable') return err.message;
  return reviewErrorText(err);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rejectionKind(value: unknown): string {
  if (isRecord(value) && typeof value.kind === 'string' && value.kind.length > 0) return value.kind;
  return 'sidecar-unavailable';
}

function messageOfKind(kind: string): string {
  const table = ERROR_MESSAGES as Record<string, string>;
  return table[kind] ?? ERROR_MESSAGES.internal;
}

/** ReviewError 依 kind 查固定句子;不認得的 kind、不是 ReviewError 的錯,都是 internal 那一句。 */
export function reviewErrorText(err: unknown): string {
  if (err instanceof ReviewError) return messageOfKind(err.kind);
  return ERROR_MESSAGES.internal;
}

function rejectionError(err: unknown): ReviewError {
  const kind = rejectionKind(err);
  const message = isRecord(err) && typeof err.message === 'string' ? err.message : messageOfKind(kind);
  return new ReviewError(kind, message, false);
}

const BAD_RESPONSE = ERROR_MESSAGES['bad-response'];

export function createReviewClient(opts?: {
  invoke?: InvokeFn;
  handler?: (line: string) => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}): ReviewClient {
  const invoke = opts?.invoke ?? tauriInvoke;
  const handler = opts?.handler;
  const sleep = opts?.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = opts?.now ?? (() => Date.now());
  let nextId = 1;
  const listeners: Array<(waiting: boolean) => void> = [];

  function onWait(listener: (waiting: boolean) => void): () => void {
    listeners.push(listener);
    return () => {
      const at = listeners.indexOf(listener);
      if (at >= 0) listeners.splice(at, 1);
    };
  }

  function announce(waiting: boolean): void {
    for (const listener of listeners.slice()) listener(waiting);
  }

  async function attempt(id: number, method: Method, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const request = { v: PROTOCOL_VERSION, id, method, params };
    let raw: unknown;
    if (handler) {
      const line = await handler(JSON.stringify(request));
      const parsed = parseResponseLine(line);
      // Stryker disable next-line ConditionalExpression: handler 回壞行時 raw 變 undefined,後面一樣丟 bad-response,結果相同
      if (!parsed.ok) throw new ReviewError('bad-response', BAD_RESPONSE);
      raw = parsed.value;
    } else {
      raw = await invoke('review', { request });
    }
    // Stryker disable next-line ConditionalExpression,StringLiteral: invoke 回字串的分支是死碼:Tauri 的 invoke 回物件
    const line = typeof raw === 'string' ? raw : JSON.stringify(raw);
    // Stryker disable next-line ConditionalExpression,StringLiteral: invoke 回字串的分支是死碼:Tauri 的 invoke 回物件
    const parsed = typeof raw === 'string' ? parseResponseLine(raw) : parseResponseLine(line);
    // Stryker disable next-line LogicalOperator: parse 成功就一定是物件(ResponseSchema),`||` 換 `&&` 結果相同
    if (!parsed.ok || !isRecord(parsed.value)) throw new ReviewError('bad-response', BAD_RESPONSE);
    const value = parsed.value;
    if (value.id !== id) throw new ReviewError('bad-response', BAD_RESPONSE);
    if (value.ok === false) {
      const error = isRecord(value.error) ? value.error : {};
      const kind = typeof error.kind === 'string' && error.kind.length > 0 ? error.kind : 'internal';
      // Stryker disable next-line ConditionalExpression: ResponseSchema 規定 error.message 是字串,此判斷恆真
      const message = typeof error.message === 'string' ? error.message : kind;
      throw new ReviewError(kind, message);
    }
    // Stryker disable next-line ConditionalExpression,LogicalOperator,StringLiteral: ResponseSchema 規定 ok 只能是 true 或 false、ok:true 的 result 是物件,此行是死碼後備
    if (value.ok !== true || !isRecord(value.result)) throw new ReviewError('bad-response', BAD_RESPONSE);
    return value.result;
  }

  async function call(method: Method, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const started = now();
    let announced = false;
    const noteElapsed = (): void => {
      if (!announced && now() - started > BUSY_NOTICE_AFTER_MS) {
        announced = true;
        announce(true);
      }
    };
    const endWait = (): void => {
      if (!announced) return;
      announced = false;
      announce(false);
    };
    try {
      for (;;) {
        if (now() - started >= BUSY_GIVE_UP_MS) {
          // Stryker disable next-line CallExpression: 最外層 catch 也會呼叫 endWait,任何一處拿掉出口仍通知「不等了」一次
          endWait();
          throw new ReviewError('timeout', ERROR_MESSAGES.timeout, true);
        }
        noteElapsed();
        const id = nextId;
        nextId += 1;
        try {
          const result = await attempt(id, method, params);
          endWait();
          return result;
        } catch (err) {
          if (err instanceof ReviewError) {
            // Stryker disable next-line CallExpression: 最外層 catch 也會呼叫 endWait,任何一處拿掉出口仍通知「不等了」一次
            endWait();
            throw err;
          }
          if (rejectionKind(err) === 'busy') {
            if (now() - started >= BUSY_GIVE_UP_MS) {
              // Stryker disable next-line CallExpression: 最外層 catch 也會呼叫 endWait,任何一處拿掉出口仍通知「不等了」一次
              endWait();
              throw new ReviewError('timeout', ERROR_MESSAGES.timeout, true);
            }
            await sleep(BUSY_RETRY_MS);
            continue;
          }
          // Stryker disable next-line CallExpression: 最外層 catch 也會呼叫 endWait,任何一處拿掉出口仍通知「不等了」一次
          endWait();
          throw rejectionError(err);
        }
      }
    } catch (err) {
      // Stryker disable next-line CallExpression: 最外層 catch 也會呼叫 endWait,任何一處拿掉出口仍通知「不等了」一次
      endWait();
      throw err;
    }
  }

  return {
    start: () => call('start', {}),
    next: () => call('next', {}),
    submit: (answer) => call('submit', answer),
    summary: () => call('summary', {}),
    status: () => call('status', {}),
    teachOpen: (category?: string) => call('teach.open', category === undefined ? {} : { category }),
    teachNext: () => call('teach.next', {}),
    teachSwitch: (category: string) => call('teach.switch', { category }),
    teachPrereq: (index: number) => call('teach.prereq', { index }),
    teachDeepen: () => call('teach.deepen', {}),
    teachPoll: () => call('teach.poll', {}),
    teachCancel: () => call('teach.cancel', {}),
    teachBack: () => call('teach.back', {}),
    onWait,
  };
}
