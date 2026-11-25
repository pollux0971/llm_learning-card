/**
 * T22 驗收 3:複習側車的訊息形狀(`packages/core/src/session/protocol.ts`,軟約定,登記在 ADR-075)。
 * 紅測試作者寫;開發 worker 不改。TS 與 Rust 讀同一份向量:`protocol.vectors.json`(Rust 端是 tests/review_sidecar.rs)。
 *
 * 工單只定了 `MAX_LINE_BYTES` 這一個名字;其餘匯出名字由這份測試固定(開發 worker 照這裡寫,協調者轉進工單):
 *   PROTOCOL_VERSION = 1、MAX_LINE_BYTES = 262144、REQUEST_METHODS(五個)、ERROR_KINDS(固定清單)、ERROR_MESSAGES(kind → 固定中文句子)
 *   RequestSchema、ResponseSchema、HelloSchema(zod,全部 z.strictObject)
 *   classifyRequestLine(line): { ok: true, request } | { ok: false, kind: 'bad-request' | 'unsupported-version' | 'unknown-method' | 'too-large', id: number | null }
 *     先判大小(位元組,不含結尾換行,≤ 262144 才往下),再 JSON、一行裡有 \r、v、信封、method、params;失敗時讀得出 id 就帶 id,讀不出是 null
 *   parseResponseLine(line) / parseHelloLine(line): { ok: true, value } | { ok: false }
 *
 * 這個檔不 import 還沒寫的模組:用算出來的 file URL 動態 import,基底上是「功能還沒有」而紅,不是 tsc 錯。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const DIR = import.meta.dirname;

type Part = string | { cp: number } | { repeat: string; times: number };
interface Entry {
  name: string;
  line?: string;
  parts?: Part[];
  ts: { ok: boolean; kind?: string; id?: number | null };
  rust?: string;
  note?: string;
}
interface Vectors {
  maxLineBytes: number;
  requests: Entry[];
  responses: Entry[];
  hello: Entry[];
}

const vectors = JSON.parse(readFileSync(join(DIR, 'protocol.vectors.json'), 'utf8')) as Vectors;

function lineOf(e: Entry): string {
  if (e.line !== undefined) return e.line;
  return (e.parts ?? [])
    .map((p) => (typeof p === 'string' ? p : 'cp' in p ? String.fromCodePoint(p.cp) : p.repeat.repeat(p.times)))
    .join('');
}

interface Protocol {
  PROTOCOL_VERSION: number;
  MAX_LINE_BYTES: number;
  REQUEST_METHODS: readonly string[];
  ERROR_KINDS: readonly string[];
  ERROR_MESSAGES: Record<string, string>;
  RequestSchema: { safeParse(v: unknown): { success: boolean } };
  ResponseSchema: { safeParse(v: unknown): { success: boolean } };
  HelloSchema: { safeParse(v: unknown): { success: boolean } };
  classifyRequestLine(line: string): { ok: true; request: unknown } | { ok: false; kind: string; id: number | null };
  parseResponseLine(line: string): { ok: boolean; value?: unknown };
  parseHelloLine(line: string): { ok: boolean; value?: unknown };
}

async function protocol(): Promise<Protocol> {
  const url = pathToFileURL(join(DIR, 'protocol.ts')).href;
  return (await import(/* @vite-ignore */ url)) as Protocol;
}

const SIDECAR_KINDS = [
  'bad-request', 'unsupported-version', 'unknown-method', 'too-large', 'root-mismatch', 'router-unavailable', 'no-cards',
  'paused', 'no-session', 'no-question', 'review-record-changed', 'internal', 'credential-unavailable',
  'teach-record-changed',
  // T43(ADR-079):深入這個加的三個種類(credential-unavailable 是既有的,字樣另有深入版,見 t43-handler.test.ts)
  'deepen-floor', 'no-model', 'deepen-failed',
];
const RUST_KINDS = ['not-configured', 'sidecar-unavailable', 'sidecar-exited', 'timeout', 'busy', 'bad-envelope', 'bad-response'];
/** ADR-077 定的全文(T37:教學卡標學過時,寫入檢查連續兩次沒過) */
const TEACH_RECORD_CHANGED_MESSAGE = '學習紀錄剛被別的地方改過,這一張還沒記成學過。請再按一次。';
/** T43 工單第 5 節定的全文(三個新種類) */
const DEEPEN_MESSAGES: Record<string, string> = {
  'deepen-floor': '這張已經是最深的一層了。',
  'no-model': '現在沒辦法產生新卡:連不上雲端,也沒有可用的本機模型。',
  'deepen-failed': '這次沒有產生出能用的卡。可以再按一次「深入這個」。',
};
/** T26 定的全文 */
const REVIEW_RECORD_CHANGED_MESSAGE = '複習紀錄剛被別的地方改過,請重新開始今天的複習。剛才那一題需要重答。';

describe('常數與固定清單(驗收 3)', () => {
  it('版本 1、一行最多 262144 位元組、十六個 method(T37 加四個教學卡動作、T43 再加四個:deepen / poll / cancel / back、T67 加唯讀的 load、T68 加 ask 與 ask.poll)', async () => {
    const p = await protocol();
    expect(p.PROTOCOL_VERSION).toBe(1);
    expect(p.MAX_LINE_BYTES).toBe(262144);
    expect(vectors.maxLineBytes).toBe(262144);
    expect([...p.REQUEST_METHODS]).toEqual(['start', 'next', 'submit', 'summary', 'status', 'teach.open', 'teach.next', 'teach.switch', 'teach.prereq', 'teach.deepen', 'teach.poll', 'teach.cancel', 'teach.back', 'teach.load', 'teach.ask', 'teach.ask.poll']);
  });

  it('協定版本不變:只加動作與種類,既有訊息的形狀不變(T43 第 5 節)', async () => {
    const p = await protocol();
    expect(p.PROTOCOL_VERSION).toBe(1);
    for (const method of ['teach.deepen', 'teach.poll', 'teach.cancel', 'teach.back']) {
      expect(p.RequestSchema.safeParse({ v: 1, id: 1, method, params: {} }).success, method).toBe(true);
      expect(p.RequestSchema.safeParse({ v: 2, id: 1, method, params: {} }).success, `${method} v2`).toBe(false);
      for (const field of ['path', 'card', 'category', 'job', 'index']) {
        expect(p.RequestSchema.safeParse({ v: 1, id: 1, method, params: { [field]: 'x' } }).success, `${method} + ${field}`).toBe(false);
      }
    }
  });

  it('錯誤 kind 的固定清單:側車 17 個(T30 加 credential-unavailable、T37 加 teach-record-changed、T43 加 deepen-floor / no-model / deepen-failed)+ Rust 7 個,不多不少', async () => {
    const p = await protocol();
    expect([...p.ERROR_KINDS].sort()).toEqual([...SIDECAR_KINDS, ...RUST_KINDS].sort());
  });

  it('每個 kind 有一句固定的中文句子:非空、彼此不同、不含例外原文的樣子', async () => {
    const p = await protocol();
    expect(Object.keys(p.ERROR_MESSAGES).sort()).toEqual([...p.ERROR_KINDS].sort());
    const messages = Object.values(p.ERROR_MESSAGES);
    for (const m of messages) {
      expect(m.trim().length, m).toBeGreaterThan(0);
      expect(m, m).toMatch(/[一-鿿]/u);
      expect(m, m).not.toMatch(/Error|undefined|\bat \S+:\d+|node_modules|\/home\/|\/tmp\/|sk-/);
    }
    expect(new Set(messages).size, '每個 kind 一句,不共用').toBe(messages.length);
  });

  it('teach-record-changed 的句子是 ADR-077 定的全文', async () => {
    const p = await protocol();
    expect(p.ERROR_MESSAGES['teach-record-changed']).toBe(TEACH_RECORD_CHANGED_MESSAGE);
  });

  it('deepen-floor / no-model / deepen-failed 的句子是 T43 工單第 5 節的全文', async () => {
    const p = await protocol();
    for (const [kind, text] of Object.entries(DEEPEN_MESSAGES)) {
      expect(p.ERROR_MESSAGES[kind], kind).toBe(text);
    }
  });

  it('review-record-changed 的句子是 T26 定的全文', async () => {
    const p = await protocol();
    expect(p.ERROR_MESSAGES['review-record-changed']).toBe(REVIEW_RECORD_CHANGED_MESSAGE);
  });

  it('credential-unavailable(T30)有一句備用的固定句子;視窗收到帶樣板訊息的錯誤行也合法', async () => {
    const p = await protocol();
    expect(p.ERROR_MESSAGES['credential-unavailable']).toBe('批改要用的金鑰不能用。請在專案根目錄的 .env 檢查。');
    const line = JSON.stringify({ v: 1, id: 3, ok: false, error: { kind: 'credential-unavailable', message: '批改要用的金鑰沒有設定:GATEWAY_API_KEY。請在專案根目錄的 .env 加上。' } });
    expect(p.parseResponseLine(line).ok).toBe(true);
  });
});

describe('請求向量:classifyRequestLine(TS)', () => {
  it('向量檔本身涵蓋四種失敗 kind 與合法請求(量尺自測:向量被刪掉會被抓到)', () => {
    const kinds = new Set(vectors.requests.filter((e) => !e.ts.ok).map((e) => e.ts.kind));
    expect([...kinds].sort()).toEqual(['bad-request', 'too-large', 'unknown-method', 'unsupported-version']);
    expect(vectors.requests.filter((e) => e.ts.ok).length).toBeGreaterThanOrEqual(8);
    const names = vectors.requests.map((e) => e.name);
    for (const must of ['v 2', 'method Start (case differs)', 'crlf line ending', 'id string "1"', 'extra top-level field']) {
      expect(names, must).toContain(must);
    }
    expect(names.some((n) => n.includes('U+2028'))).toBe(true);
    expect(names.some((n) => n.includes('U+2029'))).toBe(true);
  });

  it.each(vectors.requests.map((e) => [e.name, e] as const))('%s', async (_name, entry) => {
    const p = await protocol();
    const line = lineOf(entry);
    const got = p.classifyRequestLine(line);
    if (entry.ts.ok) {
      expect(got.ok, JSON.stringify(got)).toBe(true);
      if (got.ok) expect(got.request).toEqual(JSON.parse(line));
    } else {
      expect(got.ok, `應該拒絕:${entry.note ?? ''}`).toBe(false);
      if (!got.ok) {
        expect(got.kind).toBe(entry.ts.kind);
        expect(got.id).toBe(entry.ts.id ?? null);
      }
    }
  });

  it('壞 JSON 與太大的行不會讓 classifyRequestLine 丟錯(側車不能因為一行壞的就結束)', async () => {
    const p = await protocol();
    for (const bad of ['', '{', 'null', String.fromCharCode(0), 'x'.repeat(300_000), `{"v":1,${'"a":'.repeat(50_000)}`]) {
      expect(() => p.classifyRequestLine(bad), bad.slice(0, 20)).not.toThrow();
      expect(p.classifyRequestLine(bad).ok).toBe(false);
    }
  });
});

describe('RequestSchema:z.strictObject,params 沒有任何路徑或卡 id 欄位(驗收 3)', () => {
  const ok = { v: 1, id: 1, method: 'status', params: {} };
  it('合法的信封通過;多一個欄位、少一個欄位都不通過', async () => {
    const { RequestSchema } = await protocol();
    expect(RequestSchema.safeParse(ok).success).toBe(true);
    expect(RequestSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
    const { params: _drop, ...noParams } = ok;
    expect(RequestSchema.safeParse(noParams).success).toBe(false);
  });

  it('五個 method 的 params 都是嚴格物件:帶 path、card、dir 任何欄位都不通過', async () => {
    const { RequestSchema } = await protocol();
    for (const method of ['start', 'next', 'summary', 'status']) {
      expect(RequestSchema.safeParse({ v: 1, id: 1, method, params: {} }).success, method).toBe(true);
      for (const field of ['path', 'card', 'dir', 'learning', 'file']) {
        expect(RequestSchema.safeParse({ v: 1, id: 1, method, params: { [field]: 'x' } }).success, `${method} + ${field}`).toBe(false);
      }
    }
    expect(RequestSchema.safeParse({ v: 1, id: 1, method: 'submit', params: { fill: ['a'] } }).success).toBe(true);
    expect(RequestSchema.safeParse({ v: 1, id: 1, method: 'submit', params: { apply: 'a' } }).success).toBe(true);
    for (const field of ['path', 'card', 'dir']) {
      expect(RequestSchema.safeParse({ v: 1, id: 1, method: 'submit', params: { fill: ['a'], [field]: 'x' } }).success, `submit + ${field}`).toBe(false);
      expect(RequestSchema.safeParse({ v: 1, id: 1, method: 'submit', params: { apply: 'a', [field]: 'x' } }).success, `submit apply + ${field}`).toBe(false);
    }
  });

  it('submit 的 fill 與 apply 只能給一個,而且至少一個', async () => {
    const { RequestSchema } = await protocol();
    expect(RequestSchema.safeParse({ v: 1, id: 1, method: 'submit', params: {} }).success).toBe(false);
    expect(RequestSchema.safeParse({ v: 1, id: 1, method: 'submit', params: { fill: ['a'], apply: 'b' } }).success).toBe(false);
  });
});

describe('回應向量:parseResponseLine(TS)', () => {
  it.each(vectors.responses.map((e) => [e.name, e] as const))('%s', async (_name, entry) => {
    const p = await protocol();
    const line = lineOf(entry);
    const got = p.parseResponseLine(line);
    expect(got.ok, entry.note ?? '').toBe(entry.ts.ok);
    if (got.ok) expect(got.value).toEqual(JSON.parse(line));
  });

  it('ResponseSchema 是 strictObject:成功與失敗各一種形狀', async () => {
    const { ResponseSchema } = await protocol();
    expect(ResponseSchema.safeParse({ v: 1, id: 1, ok: true, result: {} }).success).toBe(true);
    expect(ResponseSchema.safeParse({ v: 1, id: null, ok: false, error: { kind: 'bad-request', message: 'x' } }).success).toBe(true);
    expect(ResponseSchema.safeParse({ v: 1, id: 1, ok: true, result: {}, extra: 1 }).success).toBe(false);
    expect(ResponseSchema.safeParse({ v: 1, id: 1, ok: false, error: { kind: 'x', message: 'y', stack: 'z' } }).success).toBe(false);
  });
});

describe('hello:parseHelloLine(TS)', () => {
  it.each(vectors.hello.map((e) => [e.name, e] as const))('%s', async (_name, entry) => {
    const p = await protocol();
    const got = p.parseHelloLine(lineOf(entry));
    expect(got.ok).toBe(entry.ts.ok);
    expect(p.HelloSchema.safeParse(JSON.parse(lineOf(entry))).success).toBe(entry.ts.ok);
  });
});

describe('protocol.ts 不 import 任何 node: 模組(webview 也要用)', () => {
  it('靜態:檔案存在,import 只有相對路徑與 zod', () => {
    const text = readFileSync(join(DIR, 'protocol.ts'), 'utf8');
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const specs = [...code.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]!);
    expect(specs.filter((s) => s.startsWith('node:') || ['fs', 'path', 'os', 'child_process', 'crypto'].includes(s))).toEqual([]);
    expect(specs.filter((s) => !s.startsWith('.') && !s.startsWith('@contracts/') && s !== 'zod')).toEqual([]);
    expect(code).not.toMatch(/\bprocess\.|\bBuffer\b|require\s*\(/);
  });

  it('量尺自測:掃描規則抓得到 node: 與 Buffer', () => {
    const scan = (code: string) => [...code.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]!).filter((s) => s.startsWith('node:'));
    expect(scan("import { readFileSync } from 'node:fs';")).toEqual(['node:fs']);
    expect(scan("import { z } from 'zod';")).toEqual([]);
  });
});

describe('T43:四個新動作在向量檔裡(量尺自測:向量被刪掉會被抓到)', () => {
  it('每個新動作至少一列合法請求、各至少一列不合法 params、至少一列相近的未知 method', () => {
    const okNames = vectors.requests.filter((e) => e.ts.ok).map((e) => e.name);
    for (const m of ['teach.deepen', 'teach.poll', 'teach.cancel', 'teach.back']) {
      expect(okNames.some((n) => n.includes(m)), `${m} 合法`).toBe(true);
      const bad = vectors.requests.filter((e) => !e.ts.ok && e.ts.kind === 'bad-request' && e.name.includes(m));
      expect(bad.length, `${m} 不合法 params`).toBeGreaterThanOrEqual(1);
    }
    const unknown = vectors.requests.filter((e) => !e.ts.ok && e.ts.kind === 'unknown-method').map((e) => e.name);
    expect(unknown.some((n) => n.includes('teach.deeper')), 'teach.deeper 是未知 method').toBe(true);
  });

  it('三個新種類各有一列「錯誤回應」,字樣跟 ERROR_MESSAGES 一樣', async () => {
    const p = await protocol();
    for (const kind of Object.keys(DEEPEN_MESSAGES)) {
      const entry = vectors.responses.find((e) => e.name.includes(kind));
      expect(entry, kind).toBeDefined();
      const parsed = JSON.parse(lineOf(entry!)) as { error: { kind: string; message: string } };
      expect(parsed.error.kind).toBe(kind);
      expect(parsed.error.message).toBe(p.ERROR_MESSAGES[kind]);
    }
  });
});

describe('T67:teach.load 在向量檔裡(量尺自測:向量被刪掉會被抓到)', () => {
  it('至少一列合法請求、各至少兩列不合法 params、至少一列相近的未知 method', () => {
    const okNames = vectors.requests.filter((e) => e.ts.ok).map((e) => e.name);
    expect(okNames.some((n) => n.includes('teach.load')), 'teach.load 合法').toBe(true);
    const bad = vectors.requests.filter((e) => !e.ts.ok && e.ts.kind === 'bad-request' && e.name.includes('teach.load'));
    expect(bad.length, 'teach.load 不合法 params').toBeGreaterThanOrEqual(2);
    const unknown = vectors.requests.filter((e) => !e.ts.ok && e.ts.kind === 'unknown-method').map((e) => e.name);
    expect(unknown.some((n) => n.includes('teach.loads')), 'teach.loads 是未知 method').toBe(true);
  });

  it('teach.load 的 params 是空物件:帶任何欄位都不合法,v 不是 1 也不合法', async () => {
    const p = await protocol();
    expect(p.RequestSchema.safeParse({ v: 1, id: 1, method: 'teach.load', params: {} }).success).toBe(true);
    expect(p.RequestSchema.safeParse({ v: 2, id: 1, method: 'teach.load', params: {} }).success).toBe(false);
    for (const field of ['path', 'card', 'category', 'index', 'day', 'today']) {
      expect(p.RequestSchema.safeParse({ v: 1, id: 1, method: 'teach.load', params: { [field]: 'x' } }).success, field).toBe(false);
    }
  });
});

describe('T68:teach.ask 與 teach.ask.poll 在向量檔裡(量尺自測:向量被刪掉會被抓到)', () => {
  it('兩個動作各至少一列合法請求;teach.ask 至少四列不合法 params(多了路徑 / 卡 id / 別的欄位、缺或錯型的 question),poll 至少兩列;至少一列相近的未知 method', () => {
    const okNames = vectors.requests.filter((e) => e.ts.ok).map((e) => e.name);
    expect(okNames.some((n) => n.includes('teach.ask {question}')), 'teach.ask 合法').toBe(true);
    expect(okNames.some((n) => n.includes('teach.ask.poll')), 'teach.ask.poll 合法').toBe(true);
    const bad = (m: string) => vectors.requests.filter((e) => !e.ts.ok && e.ts.kind === 'bad-request' && e.name.startsWith(`params content: ${m} `));
    expect(bad('teach.ask').length, 'teach.ask 不合法 params').toBeGreaterThanOrEqual(4);
    expect(bad('teach.ask.poll').length, 'teach.ask.poll 不合法 params').toBeGreaterThanOrEqual(2);
    const unknown = vectors.requests.filter((e) => !e.ts.ok && e.ts.kind === 'unknown-method').map((e) => e.name);
    expect(unknown.some((n) => n.includes('teach.asks')), 'teach.asks 是未知 method').toBe(true);
  });

  it('teach.ask 的 params 是 { question: 字串 } 的嚴格物件:合法一種;不收路徑、卡 id、別的任何欄位;v 不是 1 也不合法', async () => {
    const p = await protocol();
    const ask = (params: unknown, v = 1) => p.RequestSchema.safeParse({ v, id: 1, method: 'teach.ask', params }).success;
    expect(ask({ question: '為什麼?' })).toBe(true);
    expect(ask({ question: '為什麼?' }, 2)).toBe(false);
    for (const field of ['path', 'card', 'id', 'cardId', 'category', 'learning', 'file', 'dir', 'history', 'round']) {
      expect(ask({ question: 'x', [field]: 'sec-0001' }), `question + ${field}`).toBe(false);
    }
    expect(ask({}), '沒有 question').toBe(false);
    expect(ask({ path: 'cards/security/sec-0001.md' }), '只有路徑').toBe(false);
    for (const bad of [1, null, true, ['x'], { text: 'x' }]) expect(ask({ question: bad }), JSON.stringify(bad)).toBe(false);
  });

  it('teach.ask.poll 的 params 是空物件:帶任何欄位都不合法,v 不是 1 也不合法', async () => {
    const p = await protocol();
    expect(p.RequestSchema.safeParse({ v: 1, id: 1, method: 'teach.ask.poll', params: {} }).success).toBe(true);
    expect(p.RequestSchema.safeParse({ v: 2, id: 1, method: 'teach.ask.poll', params: {} }).success).toBe(false);
    for (const field of ['question', 'path', 'card', 'category', 'job', 'index']) {
      expect(p.RequestSchema.safeParse({ v: 1, id: 1, method: 'teach.ask.poll', params: { [field]: 'x' } }).success, field).toBe(false);
    }
  });

  it('協定版本仍是 1、錯誤種類清單不變(T68 沒有新的錯誤 kind:失敗走 ask.error,busy / bad-request 照舊)', async () => {
    const p = await protocol();
    expect(p.PROTOCOL_VERSION).toBe(1);
    expect([...p.ERROR_KINDS].sort()).toEqual([...SIDECAR_KINDS, ...RUST_KINDS].sort());
  });
});
