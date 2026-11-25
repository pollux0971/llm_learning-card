/**
 * T68(07 phase-6 問 AI):**真的** `scripts/review-sidecar.ts` 子行程 + 假網路(`features/steps/_fake-ask-cloud.mjs`,換掉 fetch;
 * 真 router、真 adapter、真帳本照跑)。測試 agent 寫;開發 worker 不改。cucumber 的步驟(features/steps/teach-card-phase6.steps.ts)
 * 做同樣的事,這個檔是同一批東西的 vitest 版,單檔就能跑。程序內的 handler 測試(t68-handler.test.ts)量邏輯,這裡量 handler 量不到的:
 *   - 帳:每個問答在 log.jsonl 都有 `llm_call`,task 一律 teach.ask;丟掉的 ask(換卡)已經送出的那個呼叫**照常記帳**(ADR-050,帳只能多不能少);
 *   - token 上限:送給模型的是 1536(token-limits.ts 的 teach.ask);
 *   - 背景:雲端被攔住(5–15 秒的真實情形)時 teach.ask 馬上回,別的動作照常;
 *   - 離線:沒有本機 → no-model;有本機(閘道)→ 回答標 provisional、provider 是 ollama;
 *   - 花費:到上限一個網路請求都不發;LLM_DAILY_CAP_USD=0 是沒有上限;帳本壞行不是 0;
 *   - 不落地:除了 `state/log.jsonl` 多 `llm_call` 行,整個暫存世界(卡、考題、deps、order、reviews、config、快取)位元組不變。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ledgerEvents, treeBytes } from './review-session-harness.js';
import { request, spawnSidecar, type Sidecar } from './review-sidecar-harness.js';
import { AFTER_PARENT, PARENT_TITLE, askAnswer, askOf, bodyOf, cardIdOf, createDeepenVault, isAsking, kindOf, seedBadLedgerLine, seedSpend, withTimeout, type Obj, type Vault } from './t68-harness.js';
import { removeVault } from './t43-harness.js';

const FAKE = join(import.meta.dirname, '../steps/_fake-ask-cloud.mjs');

// 每條都真的起檔案/行程,負載下會慢:逐檔放寬逾時(不動全域設定)
vi.setConfig({ testTimeout: 40_000 });

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

interface Run {
  v: Vault;
  proc: Sidecar;
  send(method: string, params?: Obj): Promise<Obj>;
  /** 模型請求的紀錄(到達當下一行) */
  requests(): { n: number; via: string; maxTokens: number | null; prompt: string }[];
  hold(): void;
  release(): void;
  reply(text: string, n?: number): void;
  until(pred: () => boolean, ms?: number): Promise<void>;
  /** teach.ask 然後等到結果 */
  askFull(question: string): Promise<{ first: Obj; done: Obj; ask: ReturnType<typeof askOf> }>;
  askDone(ms?: number): Promise<Obj>;
  /** log.jsonl 裡 task 是 teach.ask 的 llm_call */
  askCalls(): Obj[];
}

async function start(env: Record<string, string | undefined> = {}, prepare?: (v: Vault) => void, vaultOpts: Parameters<typeof createDeepenVault>[0] = {}): Promise<Run> {
  const v = createDeepenVault(vaultOpts);
  prepare?.(v);
  const ctrl = join(v.scratch, 'ctrl');
  mkdirSync(ctrl, { recursive: true });
  const reqLog = join(v.scratch, 'requests.log');
  writeFileSync(reqLog, '', 'utf8');
  const proc = spawnSidecar(v, {
    fakeCloud: FAKE,
    env: { GATEWAY_API_KEY: 'fake-gateway-key', GATEWAY_BASE_URL: 'https://gateway.invalid', LLM_DAILY_CAP_USD: '1', FAKE_ASK_REQUEST_LOG: reqLog, FAKE_ASK_CTRL: ctrl, ...env },
  });
  cleanups.push(() => {
    proc.kill();
    removeVault(v);
  });
  const hello = await proc.nextLine(20_000);
  expect(hello, '側車要先印 hello').toBeDefined();
  let id = 0;
  const send = async (method: string, params: Obj = {}): Promise<Obj> => {
    id += 1;
    return await request(proc, id, method, params);
  };
  const until = async (pred: () => boolean, ms = 15_000): Promise<void> => {
    const deadline = Date.now() + ms;
    while (!pred()) {
      if (Date.now() > deadline) throw new Error('等條件逾時');
      await new Promise((r) => setTimeout(r, 25));
    }
  };
  const askDone = async (ms = 20_000): Promise<Obj> => {
    const deadline = Date.now() + ms;
    for (;;) {
      const res = await send('teach.ask.poll');
      if (!isAsking(res)) return res;
      if (Date.now() > deadline) throw new Error('teach.ask.poll 一直是 asking');
      await new Promise((r) => setTimeout(r, 30));
    }
  };
  return {
    v,
    proc,
    send,
    requests: () =>
      readFileSync(reqLog, 'utf8')
        .split('\n')
        .filter((l) => l.trim() !== '')
        .map((l) => JSON.parse(l) as { n: number; via: string; maxTokens: number | null; prompt: string }),
    hold: () => appendFileSync(join(ctrl, 'hold'), '', 'utf8'),
    release: () => rmSync(join(ctrl, 'hold'), { force: true }),
    reply: (text, n) => writeFileSync(join(ctrl, n === undefined ? 'reply' : `reply-${n}`), text, 'utf8'),
    until,
    askDone,
    askFull: async (question) => {
      const first = await send('teach.ask', { question });
      const done = askOf(first) !== undefined || first['ok'] !== true || !isAsking(first) ? first : await askDone();
      return { first, done, ask: askOf(done) };
    },
    askCalls: () => ledgerEvents(v).filter((e) => e['type'] === 'llm_call' && e['task'] === 'teach.ask'),
  };
}

/** 學習目錄以外、問答也不該碰的地方:快取根、設定根、HOME。 */
function otherRoots(v: Vault): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const [name, dir] of [['xdgCache', v.xdgCache], ['xdgConfig', v.xdgConfig], ['home', v.home]] as const) out[name] = existsSync(dir) ? treeBytes(dir) : {};
  return out;
}

describe('背景執行、帳、token 上限(真側車 + 假網路)', () => {
  it('雲端被攔住時 teach.ask 馬上回 { asking: true };別的動作照常;放行後 poll 拿到回答;帳本一筆 llm_call、task 是 teach.ask、provider 是雲端;送出去的 token 上限是 1536', async () => {
    const r = await start();
    await r.send('teach.open');
    r.hold();
    const first = await withTimeout(r.send('teach.ask', { question: '為什麼可以丟掉一半?' }), 6000, 'teach.ask 不能等雲端回答才回');
    expect(first['ok'], JSON.stringify(first)).toBe(true);
    expect((first['result'] as Obj)['asking']).toBe(true);
    await r.until(() => r.requests().length === 1);
    const mid = await r.send('teach.ask.poll');
    expect(isAsking(mid), JSON.stringify(mid)).toBe(true);
    const load = await withTimeout(r.send('teach.load'), 5000, '雲端還沒回的時候 teach.load 要照常回');
    expect(load['ok'], JSON.stringify(load)).toBe(true);
    r.release();
    const done = await r.askDone();
    expect(done['ok'], JSON.stringify(done)).toBe(true);
    expect(askOf(done)).toMatchObject({ provisional: false, suggestion: 'continue', highlight: 'next', followups: ['沒排好會怎樣?'] });
    expect(String(askOf(done)?.answer)).toContain('清單');

    const requests = r.requests();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.via).toBe('cloud');
    expect(requests[0]!.maxTokens, 'token 上限是 teach.ask 自己的 1536').toBe(1536);
    expect(requests[0]!.prompt).toContain(PARENT_TITLE);
    expect(requests[0]!.prompt).toContain(bodyOf(PARENT_TITLE));
    expect(requests[0]!.prompt).toContain('為什麼可以丟掉一半?');

    const calls = r.askCalls();
    expect(calls, '一次問答一筆 llm_call,task 是 teach.ask').toHaveLength(1);
    expect(calls[0]).toMatchObject({ type: 'llm_call', task: 'teach.ask', provider: 'openai' });
    expect(ledgerEvents(r.v).filter((e) => e['type'] === 'llm_call' && e['task'] !== 'teach.ask'), '沒有別的 task 的呼叫').toEqual([]);
  });

  it('問的時候按下一個:照常往下、丟掉 ask;晚到的回答不回給 poll;已經送出去的那個呼叫照常記帳(帳只能多不能少)', async () => {
    const r = await start();
    await r.send('teach.open');
    r.hold();
    await r.send('teach.ask', { question: 'QTOKEN-1' });
    await r.until(() => r.requests().length === 1);
    const moved = await withTimeout(r.send('teach.next'), 5000, 'ask 跑著時 teach.next 要照常執行');
    expect(moved['ok'], JSON.stringify(moved)).toBe(true);
    expect(cardIdOf(moved)).toBe(AFTER_PARENT);
    r.reply(askAnswer({ answer: 'ATOKEN-1' }));
    r.release();
    await r.until(() => r.askCalls().length === 1);
    const poll = await r.send('teach.ask.poll');
    expect(JSON.stringify(poll)).not.toContain('ATOKEN-1');
    expect(r.askCalls(), '丟掉的 ask 已經花了錢,帳本照記').toHaveLength(1);
    // 新卡上再問,提示不含舊的問答
    r.reply(askAnswer({ answer: 'ATOKEN-2' }));
    const again = await r.askFull('QTOKEN-2');
    expect(again.ask?.answer).toBe('ATOKEN-2');
    const second = r.requests()[1]!.prompt;
    expect(second).toContain('QTOKEN-2');
    expect(second).not.toContain('QTOKEN-1');
    expect(second).not.toContain('ATOKEN-1');
    expect(second).toContain('跨來源請求');
    expect(second).not.toContain(PARENT_TITLE);
  });

  it('只有一個 ask:跑著時再問回 bad-request、不多發一個網路請求', async () => {
    const r = await start();
    await r.send('teach.open');
    r.hold();
    await r.send('teach.ask', { question: 'QTOKEN-1' });
    await r.until(() => r.requests().length === 1);
    const second = await r.send('teach.ask', { question: 'QTOKEN-2' });
    expect(second['ok']).toBe(false);
    expect(kindOf(second)).toBe('bad-request');
    r.release();
    await r.askDone();
    expect(r.requests()).toHaveLength(1);
    expect(r.askCalls()).toHaveLength(1);
  });
});

describe('失敗種類(真側車)', () => {
  it('模型回的字看不懂:error 是 unreadable、不亮;這一次的錢照記(llm_call 一筆)', async () => {
    const r = await start();
    await r.send('teach.open');
    r.reply('好的,繼續下一張。');
    const res = await r.askFull('Q');
    expect(res.done['ok'], JSON.stringify(res.done)).toBe(true);
    expect(res.ask).toMatchObject({ error: 'unreadable' });
    expect(res.ask?.highlight ?? null).toBeNull();
    expect(r.askCalls()).toHaveLength(1);
  });

  it('離線又沒有本機(雲端與閘道都不通):error 是 no-model;別的動作照常', async () => {
    const r = await start({ FAKE_ASK_OFFLINE: '1', FAKE_ASK_GATEWAY_DOWN: '1' });
    await r.send('teach.open');
    const res = await r.askFull('Q');
    expect(res.done['ok'], JSON.stringify(res.done)).toBe(true);
    expect(res.ask?.error).toBe('no-model');
    const moved = await r.send('teach.next');
    expect(moved['ok']).toBe(true);
  });

  it('離線但本機(閘道)能用:回答照拿、標 provisional、帳本 provider 是 ollama、走的是閘道', async () => {
    const r = await start({ FAKE_ASK_OFFLINE: '1' });
    await r.send('teach.open');
    const res = await r.askFull('Q');
    expect(res.done['ok'], JSON.stringify(res.done)).toBe(true);
    expect(res.ask?.error, JSON.stringify(res.done)).toBeUndefined();
    expect(res.ask?.provisional).toBe(true);
    expect(res.ask?.answer).toBeDefined();
    expect(r.requests().map((q) => q.via)).toEqual(['gateway']);
    expect(r.askCalls()[0]).toMatchObject({ task: 'teach.ask', provider: 'ollama' });
  });
});

describe('花費:到上限不呼叫(真側車,網路請求數 0)', () => {
  it('今天已花到上限:error 是 budget;網路上一個模型請求都沒發(雲端、閘道都沒有);帳本沒多 llm_call;卡照常能往下', async () => {
    const r = await start({ LLM_DAILY_CAP_USD: '1' }, (v) => seedSpend(v, 1));
    await r.send('teach.open');
    const res = await r.askFull('Q');
    expect(res.done['ok'], JSON.stringify(res.done)).toBe(true);
    expect(res.ask?.error).toBe('budget');
    expect(r.requests(), '到上限還呼叫了 AI').toEqual([]);
    expect(r.askCalls()).toEqual([]);
    const moved = await r.send('teach.next');
    expect(moved['ok']).toBe(true);
  });

  it('LLM_DAILY_CAP_USD=0 是沒有上限:花了 50 美元照樣呼叫,而且記帳', async () => {
    const r = await start({ LLM_DAILY_CAP_USD: '0' }, (v) => seedSpend(v, 50));
    await r.send('teach.open');
    const res = await r.askFull('Q');
    expect(res.ask?.error, JSON.stringify(res.done)).toBeUndefined();
    expect(res.ask?.answer).toBeDefined();
    expect(r.requests()).toHaveLength(1);
    expect(r.askCalls()).toHaveLength(1);
  });

  it('帳本有壞行:今日花費是不知道、不是 0,不發任何網路請求', async () => {
    const r = await start({ LLM_DAILY_CAP_USD: '1' }, (v) => seedBadLedgerLine(v));
    await r.send('teach.open');
    const res = await r.askFull('Q');
    expect(res.done['ok'] === false || res.ask?.error !== undefined, JSON.stringify(res.done)).toBe(true);
    expect(res.ask?.answer).toBeUndefined();
    expect(r.requests()).toEqual([]);
  });
});

describe('不落地(真側車)', () => {
  it('問答三輪(含追問、建議深入、建議回基礎):除了 log.jsonl 多 llm_call 行,學習目錄與快取根、設定根、HOME 位元組不變', async () => {
    const r = await start({}, (v) => {
      // 讓「回基礎」有東西可亮:sec-0002 多一個未學的先備
      const path = join(v.dir, 'cards/security/sec-0002.md');
      writeFileSync(path, readFileSync(path, 'utf8').replace(/^prereqs: \[.*\]$/m, `prereqs: [sec-0001, ${AFTER_PARENT}]`), 'utf8');
    });
    await r.send('teach.open');
    const before = treeBytes(r.v.dir);
    const others = otherRoots(r.v);
    r.reply(askAnswer({ suggestion: 'deepen', followups: ['一', '二'] }));
    expect((await r.askFull('Q1')).ask?.highlight).toBe('deepen');
    r.reply(askAnswer({ suggestion: 'back' }));
    expect((await r.askFull('二')).ask?.highlight).toEqual({ prereq: AFTER_PARENT });
    r.reply(askAnswer({ suggestion: 'continue' }));
    expect((await r.askFull('Q3')).ask?.highlight).toBe('next');

    const after = treeBytes(r.v.dir);
    expect(Object.keys(after).sort(), '沒有多出任何檔').toEqual(Object.keys(before).sort());
    for (const [file, bytes] of Object.entries(before)) if (file !== 'state/log.jsonl') expect(after[file], file).toBe(bytes);
    // log.jsonl:舊的內容原樣在前面,後面只多 llm_call 行(task 都是 teach.ask)
    const oldLog = Buffer.from(before['state/log.jsonl']!, 'base64').toString('utf8');
    const newLog = Buffer.from(after['state/log.jsonl']!, 'base64').toString('utf8');
    expect(newLog.startsWith(oldLog)).toBe(true);
    const added = newLog
      .slice(oldLog.length)
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => JSON.parse(l) as Obj);
    expect(added).toHaveLength(3);
    for (const line of added) expect(line).toMatchObject({ type: 'llm_call', task: 'teach.ask' });
    expect(otherRoots(r.v)).toEqual(others);
    // 卡沒有被「建議」動到
    const still = await r.send('teach.open');
    expect(cardIdOf(still)).toBe('sec-0002');
  });
});
