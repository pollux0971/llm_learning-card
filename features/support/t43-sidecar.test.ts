/**
 * T43(07 phase-3):**真的** `scripts/review-sidecar.ts` 子行程 + 假網路(`features/steps/_fake-deepen-cloud.mjs`,換掉 fetch;
 * 真 router、真 adapter、真帳本照跑)。測試 agent 寫;開發 worker 不改。cucumber 的步驟(features/steps/teach-card-phase3.steps.ts)
 * 做同樣的事,這個檔是同一批東西的 vitest 版,單檔就能跑。
 *
 * 量到的是 handler 的程序內測試量不到的:
 *   - 帳:每個深入的呼叫在 log.jsonl 都有 `llm_call`,task 一律 deepen;取消時已經送出的那一個呼叫**照常記帳**(ADR-050,帳只能多不能少);
 *   - 離線走閘道:provider 是 ollama、新卡 provisional;閘道也不通 → no-model;
 *   - stdin 結束(關 app):不等手上的呼叫、馬上結束、之後沒有寫檔;
 *   - 生成中考試卡的 start / next 馬上回。
 */
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseCardText } from '../../packages/core/src/schema/parse-card.js';
import { seedDue } from './review-session-harness.js';
import { spawnSidecar, request, type Sidecar } from './review-sidecar-harness.js';
import {
  PARENT,
  cardFiles,
  cleanupRigs,
  createDeepenVault,
  diskHashes,
  errorKind,
  errorMessage,
  logEvents,
  newIds,
  readCardText,
  removeVault,
  type DeepView,
  type Obj,
  type Vault,
} from './t43-harness.js';

const FAKE = join(import.meta.dirname, '../steps/_fake-deepen-cloud.mjs');
const BASE = ['sec-0001', 'sec-0002', 'sec-0003'];

interface Run {
  v: Vault;
  proc: Sidecar;
  ctrl: string;
  reqLog: string;
  send(method: string, params?: Obj): Promise<Obj>;
  requests(): { via: string; kind: string; card?: string; title?: string }[];
  hold(kind: string): void;
  release(kind: string): void;
  until(pred: () => boolean, ms?: number): Promise<void>;
}

// 每條都真的起檔案/行程,負載下會慢:逐檔放寬逾時(不動全域設定)
vi.setConfig({ testTimeout: 30_000 });

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

async function start(env: Record<string, string | undefined> = {}, vaultOpts: Parameters<typeof createDeepenVault>[0] = {}): Promise<Run> {
  const v = createDeepenVault(vaultOpts);
  const ctrl = join(v.scratch, 'ctrl');
  mkdirSync(ctrl, { recursive: true });
  const reqLog = join(v.scratch, 'requests.log');
  writeFileSync(reqLog, '', 'utf8');
  const proc = spawnSidecar(v, {
    fakeCloud: FAKE,
    env: { GATEWAY_API_KEY: 'fake-gateway-key', GATEWAY_BASE_URL: 'https://gateway.invalid', FAKE_DEEPEN_REQUEST_LOG: reqLog, FAKE_DEEPEN_CTRL: ctrl, ...env },
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
  return {
    v,
    proc,
    ctrl,
    reqLog,
    send,
    requests: () =>
      readFileSync(reqLog, 'utf8')
        .split('\n')
        .filter((l) => l.trim() !== '')
        .map((l) => JSON.parse(l) as { via: string; kind: string; card?: string; title?: string }),
    hold: (kind) => appendFileSync(join(ctrl, `hold-${kind}`), '', 'utf8'),
    release: (kind) => rmSync(join(ctrl, `hold-${kind}`), { force: true }),
    until,
  };
}

async function pollDone(r: Run, ms = 20_000): Promise<Obj> {
  const deadline = Date.now() + ms;
  for (;;) {
    const res = await r.send('teach.poll');
    if (!(res['ok'] === true && (res['result'] as DeepView).generating === true)) return res;
    if (Date.now() > deadline) throw new Error('teach.poll 一直是 generating');
    await new Promise((x) => setTimeout(x, 30));
  }
}

const llmCalls = (v: Vault): Obj[] => logEvents(v, 'llm_call');

describe('Scenario: Children are generated when there are none(@llm,假網路)', () => {
  it('在線:輪詢到成功;1 到 3 張新卡;帳本每一筆 llm_call 的 task 都是 deepen;provider 是雲端;卡不是 provisional', async () => {
    const r = await start();
    await r.send('teach.open');
    const started = await r.send('teach.deepen');
    expect(started['ok'], JSON.stringify(started)).toBe(true);
    expect((started['result'] as DeepView).generating).toBe(true);
    const done = await pollDone(r);
    expect(done['ok'], JSON.stringify(done)).toBe(true);
    expect((done['result'] as DeepView).card?.id).toBe('sec-0004');
    expect(cardFiles(r.v)).toEqual([...BASE, ...newIds(2)]);
    for (const id of newIds(2)) {
      const fm = parseCardText(readCardText(r.v, id)).frontmatter as Record<string, unknown>;
      expect(fm).toMatchObject({ level: 2, parent: PARENT, source: 'llm', provisional: false });
    }
    const calls = llmCalls(r.v);
    expect(calls, '子卡 1 次 + 考題 2 次').toHaveLength(3);
    for (const c of calls) {
      expect(c['task']).toBe('deepen');
      expect(c['provider']).not.toBe('ollama');
    }
    expect(r.requests().map((q) => q.kind)).toEqual(['children', 'questions', 'questions']);
    expect(logEvents(r.v, 'deepened')).toHaveLength(1);
  });

  it('沒有 ingest.cards / ingest.questions 的 llm_call(整個一次深入裡)', async () => {
    const r = await start();
    await r.send('teach.open');
    await r.send('teach.deepen');
    await pollDone(r);
    expect(llmCalls(r.v).filter((c) => String(c['task']).startsWith('ingest.'))).toEqual([]);
  });
});

describe('Scenario: Offline generation falls back and is marked / No model at all is reported plainly', () => {
  it('雲端探測失敗、閘道會回:新卡 provisional: true;llm_call 的 provider 是 ollama,task 仍是 deepen;考題檔也出得來', async () => {
    const r = await start({ FAKE_DEEPEN_OFFLINE: '1' });
    await r.send('teach.open');
    await r.send('teach.deepen');
    const done = await pollDone(r);
    expect(done['ok'], JSON.stringify(done)).toBe(true);
    for (const id of newIds(2)) {
      expect((parseCardText(readCardText(r.v, id)).frontmatter as Record<string, unknown>)['provisional'], id).toBe(true);
      expect(existsSync(join(r.v.dir, 'questions', `${id}.yaml`)), `${id} 的考題檔`).toBe(true);
    }
    const calls = llmCalls(r.v).filter((c) => c['provider'] === 'ollama');
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(llmCalls(r.v).every((c) => c['task'] === 'deepen')).toBe(true);
    expect(r.requests().every((q) => q.via === 'gateway')).toBe(true);
    expect(logEvents(r.v, 'deepened')[0]).toMatchObject({ provisional: true });
  });

  it('雲端探測失敗、閘道也不通:poll 回 no-model + 固定字樣;畫面還是原本那張;磁碟不變', async () => {
    const r = await start({ FAKE_DEEPEN_OFFLINE: '1', FAKE_DEEPEN_GATEWAY_DOWN: '1' });
    await r.send('teach.open');
    const before = diskHashes(r.v);
    await r.send('teach.deepen');
    const done = await pollDone(r);
    expect(done['ok']).toBe(false);
    expect(errorKind(done)).toBe('no-model');
    expect(errorMessage(done)).toBe('現在沒辦法產生新卡:連不上雲端,也沒有可用的本機模型。');
    expect(diskHashes(r.v)).toEqual(before);
    const view = (await r.send('teach.poll'))['result'] as DeepView;
    expect(view.card?.id).toBe(PARENT);
    expect(r.proc.isAlive()).toBe(true);
  });
});

describe('Scenario: Cancelling writes nothing', () => {
  it('子卡的請求還沒回就取消:cancel 回原本那張;放行之後磁碟不變、沒有 deepened、假網路剛好 1 行、帳本有那一個呼叫的 llm_call', async () => {
    const r = await start();
    await r.send('teach.open');
    const before = diskHashes(r.v);
    r.hold('children');
    await r.send('teach.deepen');
    await r.until(() => r.requests().length >= 1);
    const cancelled = await r.send('teach.cancel');
    expect(cancelled['ok'], JSON.stringify(cancelled)).toBe(true);
    expect((cancelled['result'] as DeepView).card?.id).toBe(PARENT);
    expect((cancelled['result'] as DeepView).generating).toBe(false);
    expect(llmCalls(r.v), '放行之前還沒有那一筆').toHaveLength(0);
    r.release('children');
    await r.until(() => llmCalls(r.v).length >= 1);
    await new Promise((x) => setTimeout(x, 400));
    expect(llmCalls(r.v), '已經送出的那一個呼叫照常記帳(不中斷、不漏記)').toHaveLength(1);
    expect(llmCalls(r.v)[0]!['task']).toBe('deepen');
    expect(diskHashes(r.v)).toEqual(before);
    expect(logEvents(r.v, 'deepened')).toEqual([]);
    expect(r.requests(), '取消之後不再發新的請求(考題一個都沒出)').toHaveLength(1);
  });

  it('取消後馬上再按深入(舊請求還被攔著):新工作完成;舊請求晚回來不寫檔、不多記 deepened、帳本兩筆子卡呼叫都在', async () => {
    const r = await start();
    await r.send('teach.open');
    r.hold('children');
    await r.send('teach.deepen');
    await r.until(() => r.requests().length >= 1);
    await r.send('teach.cancel');
    // 新工作的子卡請求也會被 hold-children 攔住;放行一次讓兩個都過
    await r.send('teach.deepen');
    await r.until(() => r.requests().length >= 2);
    r.release('children');
    const done = await pollDone(r);
    expect(done['ok'], JSON.stringify(done)).toBe(true);
    await new Promise((x) => setTimeout(x, 400));
    expect(cardFiles(r.v)).toEqual([...BASE, ...newIds(2)]);
    expect(logEvents(r.v, 'deepened')).toHaveLength(1);
    expect(r.requests().filter((q) => q.kind === 'children')).toHaveLength(2);
    expect(r.requests().filter((q) => q.kind === 'questions'), '考題只替新工作出').toHaveLength(2);
    expect(llmCalls(r.v)).toHaveLength(4);
  });
});

describe('側車讀到 stdin 結束(關 app):進行中的工作當成取消,馬上結束行程,不等手上的呼叫,之後沒有寫檔', () => {
  it('請求被攔著時關 stdin:行程在幾秒內結束(退出碼 0);磁碟不變;沒有 deepened', async () => {
    const r = await start();
    await r.send('teach.open');
    const before = diskHashes(r.v);
    r.hold('children');
    await r.send('teach.deepen');
    await r.until(() => r.requests().length >= 1);
    const t0 = Date.now();
    r.proc.endStdin();
    const code = await r.proc.exited(8_000);
    expect(code, '不能等手上的呼叫(它被攔著,永遠不會回來)').toBe(0);
    expect(Date.now() - t0).toBeLessThan(8_000);
    r.release('children');
    await new Promise((x) => setTimeout(x, 400));
    expect(diskHashes(r.v)).toEqual(before);
    expect(logEvents(r.v, 'deepened')).toEqual([]);
  });

  it('沒有進行中的工作時關 stdin:照舊正常結束', async () => {
    const r = await start();
    await r.send('teach.open');
    r.proc.endStdin();
    expect(await r.proc.exited(8_000)).toBe(0);
  });
});

describe('生成中考試卡不被擋(D1)', () => {
  it('子卡請求被攔著時,考試卡 start 與 next 馬上拿到回應', async () => {
    const r = await start({}, { learned: ['sec-0001'] });
    seedDue(r.v, ['sec-0001'], [1]);
    await r.send('teach.open');
    r.hold('children');
    await r.send('teach.deepen');
    await r.until(() => r.requests().length >= 1);
    const t0 = Date.now();
    const started = await r.send('start');
    expect(started['ok'], JSON.stringify(started)).toBe(true);
    const next = await r.send('next');
    expect(next['ok'], JSON.stringify(next)).toBe(true);
    expect(Date.now() - t0, '不用等生成結束').toBeLessThan(5_000);
    r.release('children');
    await pollDone(r);
  });
});

describe('工作裡的錯不會讓側車結束', () => {
  it('子卡回應不是合法 JSON:poll 回 deepen-failed;側車還活著;教學卡之後照常', async () => {
    const r = await start({ FAKE_DEEPEN_BAD_CHILDREN: '1' });
    await r.send('teach.open');
    await r.send('teach.deepen');
    const done = await pollDone(r);
    expect(errorKind(done)).toBe('deepen-failed');
    expect(r.proc.isAlive()).toBe(true);
    const next = await r.send('teach.next');
    expect(next['ok']).toBe(true);
  });

  it('金鑰缺了(環境沒有 OPENAI_API_KEY):deepen 當場回 credential-unavailable,字樣是深入版;不打任何請求', async () => {
    const r = await start({ OPENAI_API_KEY: undefined, ANTHROPIC_API_KEY: undefined });
    await r.send('teach.open');
    const res = await r.send('teach.deepen');
    expect(res['ok']).toBe(false);
    expect(errorKind(res)).toBe('credential-unavailable');
    expect(errorMessage(res)).toBe('產生新卡要用的金鑰沒有設定:OPENAI_API_KEY。請在專案根目錄的 .env 加上。');
    expect(r.requests()).toHaveLength(0);
  });

  it('字數:一張三次都超過 100 字 → 只留一張;重寫的請求剛好 2 個;帳本的 task 全是 deepen', async () => {
    const r = await start({ FAKE_DEEPEN_LONG_TITLE: '新卡2' });
    await r.send('teach.open');
    await r.send('teach.deepen');
    const done = await pollDone(r);
    expect(done['ok'], JSON.stringify(done)).toBe(true);
    expect(r.requests().filter((q) => q.kind === 'regenerate')).toHaveLength(2);
    expect(cardFiles(r.v).filter((id) => !BASE.includes(id))).toHaveLength(1);
    expect(llmCalls(r.v).every((c) => c['task'] === 'deepen')).toBe(true);
    expect(logEvents(r.v, 'warning')).toHaveLength(1);
  });
});

describe('stdout 只有 JSON 行(深入沒有印雜訊)', () => {
  it('整段深入之後,每一行 stdout 都是合法 JSON', async () => {
    const r = await start();
    await r.send('teach.open');
    await r.send('teach.deepen');
    await pollDone(r);
    for (const line of r.proc.stdoutLines) expect(() => JSON.parse(line), line).not.toThrow();
    cleanupRigs();
  });
});
