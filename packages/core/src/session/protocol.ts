/**
 * 複習側車的訊息形狀(ADR-075,軟約定)。
 * webview 也 import 這份:不碰 node: 模組,只依賴 zod。
 */
import { z } from 'zod';

export const PROTOCOL_VERSION = 1;
export const MAX_LINE_BYTES = 262144;
export const REQUEST_METHODS = ['start', 'next', 'submit', 'summary', 'status'] as const;
export type RequestMethod = (typeof REQUEST_METHODS)[number];

export const ERROR_KINDS = [
  'bad-request',
  'unsupported-version',
  'unknown-method',
  'too-large',
  'root-mismatch',
  'router-unavailable',
  'no-cards',
  'paused',
  'no-session',
  'no-question',
  'review-record-changed',
  'internal',
  'not-configured',
  'sidecar-unavailable',
  'sidecar-exited',
  'timeout',
  'busy',
  'bad-envelope',
  'bad-response',
] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];

/** 每個 kind 一句固定中文,回給視窗的 message 只用這裡的句子。 */
export const ERROR_MESSAGES: Record<ErrorKind, string> = {
  'bad-request': '這一列不是合法的請求。',
  'unsupported-version': '不支援這個協定版本。',
  'unknown-method': '不認識這個動作。',
  'too-large': '這一列超過長度上限。',
  'root-mismatch': '學習目錄跟指標檔指向的地方不一樣。',
  'router-unavailable': '帳本現在無法使用。',
  'no-cards': '卡片目錄裡沒有任何卡片。',
  paused: '今天的複習已經暫停。',
  'no-session': '還沒開始今天的複習。',
  'no-question': '現在沒有可以送出的題目。',
  'review-record-changed': '複習紀錄剛被別的地方改過,請重新開始今天的複習。剛才那一題需要重答。',
  internal: '內部發生問題,請稍後再試。',
  'not-configured': '學習目錄還沒設定好。',
  'sidecar-unavailable': '複習輔助程式無法啟動。',
  'sidecar-exited': '複習輔助程式已經結束。',
  timeout: '等候回覆的時間過了。',
  busy: '已經有一個請求正在處理。',
  'bad-envelope': '請求的信封不合規定。',
  'bad-response': '回覆的那一列無法使用。',
};

const IdSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const EmptyParams = z.strictObject({});
const SubmitParams = z.union([
  z.strictObject({ fill: z.array(z.string()) }),
  z.strictObject({ apply: z.string() }),
]);

export const RequestSchema = z.discriminatedUnion('method', [
  z.strictObject({ v: z.literal(1), id: IdSchema, method: z.literal('start'), params: EmptyParams }),
  z.strictObject({ v: z.literal(1), id: IdSchema, method: z.literal('next'), params: EmptyParams }),
  z.strictObject({ v: z.literal(1), id: IdSchema, method: z.literal('summary'), params: EmptyParams }),
  z.strictObject({ v: z.literal(1), id: IdSchema, method: z.literal('status'), params: EmptyParams }),
  z.strictObject({ v: z.literal(1), id: IdSchema, method: z.literal('submit'), params: SubmitParams }),
]);

const ResultObject = z.record(z.string(), z.unknown());
export const ResponseSchema = z.union([
  z.strictObject({
    v: z.literal(1),
    id: IdSchema,
    ok: z.literal(true),
    result: ResultObject,
  }),
  z.strictObject({
    v: z.literal(1),
    id: IdSchema.nullable(),
    ok: z.literal(false),
    error: z.strictObject({ kind: z.string(), message: z.string() }),
  }),
]);

export const HelloSchema = z.strictObject({
  v: z.literal(1),
  kind: z.literal('hello'),
  fakeCloud: z.boolean(),
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type ClassifyFailureKind = 'bad-request' | 'unsupported-version' | 'unknown-method' | 'too-large';
export type ClassifiedRequest =
  | { ok: true; request: unknown }
  | { ok: false; kind: ClassifyFailureKind; id: number | null };

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/** 不含結尾換行。字串裡的 U+2028 / U+2029 不當成換行,不剝。 */
function lineBody(line: string): string {
  return line.endsWith('\n') ? line.slice(0, -1) : line;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 讀得出「≥ 1 的安全整數」才帶,否則 null。 */
function readableId(value: unknown): number | null {
  if (!isRecord(value)) return null;
  const id = value.id;
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) return null;
  return id;
}

function fail(kind: ClassifyFailureKind, id: number | null): ClassifiedRequest {
  return { ok: false, kind, id };
}

/**
 * 判斷順序:大小 → JSON → 一行裡有 CR → v 存在但不是 1 → method 是字串但不在五個裡 → 其餘信封或 params。
 * 太大的那一列不嘗試讀 id。不丟錯。
 */
export function classifyRequestLine(line: string): ClassifiedRequest {
  try {
    const body = lineBody(line);
    if (utf8Bytes(body) > MAX_LINE_BYTES) return fail('too-large', null);
    // 一行裡有 CR(含 CRLF)一律 bad-request,而且不把 id 算成讀得出來(向量如此)。
    if (body.includes('\r')) return fail('bad-request', null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(body) as unknown;
    } catch {
      return fail('bad-request', null);
    }
    if (isRecord(parsed) && Object.prototype.hasOwnProperty.call(parsed, 'v') && parsed.v !== 1) {
      return fail('unsupported-version', readableId(parsed));
    }
    if (isRecord(parsed) && typeof parsed.method === 'string' && !(REQUEST_METHODS as readonly string[]).includes(parsed.method)) {
      return fail('unknown-method', readableId(parsed));
    }
    if (!RequestSchema.safeParse(parsed).success) return fail('bad-request', readableId(parsed));
    return { ok: true, request: parsed };
  } catch {
    return fail('bad-request', null);
  }
}

export function parseResponseLine(line: string): { ok: true; value: unknown } | { ok: false } {
  try {
    const body = lineBody(line);
    if (utf8Bytes(body) > MAX_LINE_BYTES) return { ok: false };
    const parsed: unknown = JSON.parse(body);
    if (!ResponseSchema.safeParse(parsed).success) return { ok: false };
    return { ok: true, value: parsed };
  } catch {
    return { ok: false };
  }
}

export function parseHelloLine(line: string): { ok: true; value: unknown } | { ok: false } {
  try {
    const body = lineBody(line);
    if (utf8Bytes(body) > MAX_LINE_BYTES) return { ok: false };
    const parsed: unknown = JSON.parse(body);
    if (!HelloSchema.safeParse(parsed).success) return { ok: false };
    return { ok: true, value: parsed };
  } catch {
    return { ok: false };
  }
}
