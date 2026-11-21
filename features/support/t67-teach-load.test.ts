/**
 * T67 紅測試(側車 handler):教學卡的今日負擔 `load` 與唯讀動作 `teach.load`(ADR-085)。測試 agent 寫;開發 worker 不改。
 * 工單:docs/tickets/T67-teach-card-daily-load-hint.md「要的結果」第 3 節、「紅測試」表的「唯讀」與 must_catch 前 11 條。
 *
 * 看磁碟、看回應,不看畫面。世界是 teach-harness 的三類別 vault(今天 = 2026-09-10,機器日期不是這天;`TOMORROW` = 2026-09-11,每日上限 10)。
 * handler 用算出來的 file URL 動態 import(基底上是「功能還沒有」而紅,不是 tsc 錯)。路由器全是程序內的假物件:不打網路、不花錢。
 * 全部用暫存目錄(learning、XDG_*、HOME 同一個 mkdtemp),不碰真的 learning/。
 *
 * 預期值全部手算:
 *   learnedToday = reviews.json 裡 learned_at 等於 handler 的「今天」的紀錄數(不看 log.jsonl、不看 weekly.json、不看機器日期);
 *   dueTomorrow  = 考試卡小結的「明天預估」(shown):buildDueList(reviews, 明天) 張數,今天考試卡回退的先扣再加回(estimateTomorrowFrom),再套每日上限。
 *
 * 本來就綠(基底上已成立,守不退步):沒有(整個檔都是新的行為)。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { NoModelError } from '../../packages/core/src/llm/errors.js';
import { scriptedApplyReply } from '../steps/_i2-cloud-script.js';
import { childEnv, cacheBase, cachePath, reviewRecord, seedDue } from './review-session-harness.js';
import { TODAY, TOMORROW, createTeachVault, freshLearned, logText, readReviews, removeVault, requestLine, reviewsText, writeReviews, type TeachVaultOpts, type Vault } from './teach-harness.js';
import { cleanupRigs, deepRig, diskHashes } from './t43-harness.js';

const ROOT = join(import.meta.dirname, '../..');
const HANDLER = pathToFileURL(join(ROOT, 'packages/core/src/session/handler.ts')).href;
const YESTERDAY = '2026-09-09';

type Obj = Record<string, unknown>;
type Handler = (line: string) => Promise<string>;
interface Load {
  learnedToday: number;
  dueTomorrow: number;
}

const vaults: Vault[] = [];
afterAll(() => {
  for (const v of vaults) removeVault(v);
  cleanupRigs();
});

function makeRouter() {
  return {
    async call(task: string, prompt: string) {
      if (task !== 'grade.apply') throw new NoModelError('grade.fill.llm');
      return { text: scriptedApplyReply(prompt), provider: 'fake', model: 'recorded', latency_ms: 0, provisional: false };
    },
    async probeOnline() {
      return true;
    },
    async probeLocal() {
      return { available: false, models: [] };
    },
  };
}

interface Rig {
  v: Vault;
  /** 同一個 vault 再開一個全新的 handler(模擬關掉視窗/側車重啟) */
  restart(): Promise<Rig>;
  send(method: string, params?: Obj): Promise<Obj>;
  /** 成功的 teach.* → result */
  ok(method: string, params?: Obj): Promise<Obj & { load?: Load }>;
  load(): Promise<Load>;
  answerAllWrong(): Promise<number>;
}

async function handlerFor(v: Vault, today: string | (() => string)): Promise<Rig> {
  const mod = (await import(/* @vite-ignore */ HANDLER)) as { createReviewHandler(deps: Obj): Handler };
  const handler = mod.createReviewHandler({ learningDir: v.dir, today, routerFactory: () => makeRouter(), env: childEnv(v) });
  let id = 0;
  const send = async (method: string, params: Obj = {}): Promise<Obj> => {
    id += 1;
    return JSON.parse(await handler(requestLine(id, method, params))) as Obj;
  };
  const ok = async (method: string, params: Obj = {}) => {
    const res = await send(method, params);
    expect(res['ok'], `${method} 應該成功:${JSON.stringify(res)}`).toBe(true);
    return res['result'] as Obj & { load?: Load };
  };
  const rig: Rig = {
    v,
    restart: () => handlerFor(v, today),
    send,
    ok,
    load: async () => (await ok('teach.load')) as unknown as Load,
    answerAllWrong: async () => {
      let answered = 0;
      for (let i = 0; i < 20; i += 1) {
        const q = (await ok('next')) as Obj;
        if (q['kind'] === 'done') break;
        if (q['kind'] !== 'question') continue;
        const params = q['type'] === 'fill' ? { fill: Array.from({ length: Number(q['blanks']) }, () => 'x') } : { apply: 'x' };
        await ok('submit', params);
        answered += 1;
      }
      return answered;
    },
  };
  return rig;
}

async function rig(opts: TeachVaultOpts & { today?: string | (() => string); dailyCap?: number } = {}): Promise<Rig> {
  const v = createTeachVault(opts);
  vaults.push(v);
  if (opts.dailyCap !== undefined) setDailyCap(v, opts.dailyCap);
  return handlerFor(v, opts.today ?? TODAY);
}

function setDailyCap(v: Vault, cap: number): void {
  const path = join(v.dir, 'config/settings.yaml');
  writeFileSync(path, readFileSync(path, 'utf8').replace(/^daily_cap:.*$/m, `daily_cap: ${cap}`), 'utf8');
}

/** 今天學了 todayIds、昨天學了 yesterdayIds(昨天學的 next_due 是今天:也算明天以前到期) */
function seedLearned(v: Vault, todayIds: string[], yesterdayIds: string[] = []): void {
  const reviews = existsSync(join(v.dir, 'state/reviews.json')) ? readReviews(v) : {};
  for (const id of todayIds) reviews[id] = freshLearned(TODAY, TOMORROW);
  for (const id of yesterdayIds) reviews[id] = freshLearned(YESTERDAY, TODAY);
  writeReviews(v, reviews);
}

/** 目錄樹的內容快照:相對路徑 → 內容。目錄不存在是 null */
function tree(dir: string): Record<string, string> | null {
  if (!existsSync(dir)) return null;
  const out: Record<string, string> = {};
  const walk = (rel: string): void => {
    for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const r = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        out[`${r}/`] = '';
        walk(r);
      } else out[r] = readFileSync(join(dir, r), 'utf8');
    }
  };
  walk('');
  return out;
}

const errorKind = (res: Obj): string => String((res['error'] as Obj | undefined)?.['kind']);

describe('今天學了幾張(learnedToday)', () => {
  it('只數 learned_at 是今天的:今天 4 張、昨天 1 張 → 4(teach.open 與 teach.load 都是)', async () => {
    const r = await rig();
    seedLearned(r.v, ['sec-0001', 'sec-0002', 'sec-0003', 'lang-0001'], ['lang-0002']);
    expect((await r.ok('teach.open')).load?.learnedToday).toBe(4);
    expect((await r.load()).learnedToday).toBe(4);
  });

  it('不數 log.jsonl 的 learned 事件(帳本裡有 3 筆今天的 learned,reviews.json 裡這幾張是昨天學的 → 0)', async () => {
    const r = await rig();
    seedLearned(r.v, [], ['sec-0001', 'sec-0002', 'sec-0003']);
    const ts = `${TODAY}T08:00:00.000Z`;
    writeFileSync(join(r.v.dir, 'state/log.jsonl'), ['sec-0001', 'sec-0002', 'sec-0003'].map((card) => JSON.stringify({ ts, type: 'learned', card })).join('\n') + '\n', 'utf8');
    expect((await r.load()).learnedToday).toBe(0);
    expect((await r.ok('teach.open')).load?.learnedToday).toBe(0);
  });

  it('不用 weekly.json(裡面寫了一個很大的數字,不影響)', async () => {
    const r = await rig();
    seedLearned(r.v, ['sec-0001']);
    writeFileSync(join(r.v.dir, 'state/weekly.json'), JSON.stringify({ '2026-W37': { cards: ['sec-0001', 'x-1', 'x-2', 'x-3', 'x-4', 'x-5'], count: 6, learned: 6 } }), 'utf8');
    expect((await r.load()).learnedToday).toBe(1);
  });

  it('「今天」是 handler 的今天(LC_REVIEW_TODAY 那一天),不是機器的日期:機器日期學的那張不算', async () => {
    const r = await rig();
    const now = new Date();
    const machineLocal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const machineUtc = now.toISOString().slice(0, 10);
    expect([machineLocal, machineUtc], '佈置:機器日期不能剛好是釘的那一天').not.toContain(TODAY);
    const reviews = { 'sec-0001': freshLearned(machineLocal, TOMORROW), 'sec-0002': freshLearned(machineUtc, TOMORROW), 'sec-0003': freshLearned(TODAY, TOMORROW) };
    writeReviews(r.v, reviews);
    expect((await r.load()).learnedToday).toBe(1);
  });

  it('today 是函式(start 之前每次問):釘的日期換了,數的就跟著換', async () => {
    const day = { value: TODAY };
    const r = await rig({ today: () => day.value });
    seedLearned(r.v, ['sec-0001', 'sec-0002']);
    expect((await r.load()).learnedToday).toBe(2);
    day.value = TOMORROW;
    expect((await r.load()).learnedToday).toBe(0);
  });

  it('按「下一個」:同一次回應就帶新的數字(先寫檔、再算數字)', async () => {
    const r = await rig();
    seedLearned(r.v, ['sec-0001', 'sec-0003', 'lang-0001', 'lang-0002'], ['net-0001']);
    const opened = await r.ok('teach.open');
    expect(opened.load?.learnedToday).toBe(4);
    const next = await r.ok('teach.next');
    expect(next.load?.learnedToday).toBe(5);
    expect(Object.keys(readReviews(r.v))).toContain('sec-0002');
  });

  it('換類別:同一次回應就帶新的數字(目前那張記成學過)', async () => {
    const r = await rig();
    seedLearned(r.v, ['sec-0001'], []);
    expect((await r.ok('teach.open')).load?.learnedToday).toBe(1);
    const switched = await r.ok('teach.switch', { category: 'network' });
    expect(switched.load?.learnedToday).toBe(2);
  });

  it('關掉再開(側車重啟、視窗歸零)數字還在:從磁碟算,不是記在記憶體', async () => {
    const r = await rig();
    await r.ok('teach.open');
    await r.ok('teach.next');
    await r.ok('teach.next');
    const again = await r.restart();
    expect((await again.ok('teach.open')).load?.learnedToday).toBe(2);
    expect((await again.load()).learnedToday).toBe(2);
  });

  it('同一張卡學兩次不重複算(已經在 reviews 裡的不重記)', async () => {
    const r = await rig();
    await r.ok('teach.open');
    await r.ok('teach.next');
    const again = await r.restart();
    await again.ok('teach.open', { category: 'security' });
    expect((await again.load()).learnedToday).toBe(1);
  });
});

describe('明天大約幾張(dueTomorrow)', () => {
  it('明天到期的張數(今天學的 4 張明天到期 + 昨天學的 1 張今天到期,都算) → 5', async () => {
    const r = await rig();
    seedLearned(r.v, ['sec-0001', 'sec-0002', 'sec-0003', 'lang-0001'], ['lang-0002']);
    expect((await r.ok('teach.open')).load?.dueTomorrow).toBe(5);
    expect((await r.load()).dueTomorrow).toBe(5);
  });

  it('學一張,明天的估計加 1(每次回應都重算,不是開啟時算一次):0 → 1 → 2 → 3', async () => {
    const r = await rig();
    expect((await r.ok('teach.open')).load).toEqual({ learnedToday: 0, dueTomorrow: 0 });
    expect((await r.ok('teach.next')).load).toEqual({ learnedToday: 1, dueTomorrow: 1 });
    expect((await r.ok('teach.next')).load).toEqual({ learnedToday: 2, dueTomorrow: 2 });
    expect((await r.ok('teach.next')).load).toEqual({ learnedToday: 3, dueTomorrow: 3 });
  });

  it('套每日上限:上限 2,學到第 3 張 → 顯示 2(shown),不是 3', async () => {
    const r = await rig({ dailyCap: 2 });
    expect((await r.ok('teach.open')).load?.dueTomorrow).toBe(0);
    expect((await r.ok('teach.next')).load?.dueTomorrow).toBe(1);
    expect((await r.ok('teach.next')).load?.dueTomorrow).toBe(2);
    expect((await r.ok('teach.next')).load?.dueTomorrow, '剛好等於上限之後再學一張:還是上限').toBe(2);
    expect((await r.load()).dueTomorrow).toBe(2);
  });

  it('明天到期的比上限多(場景「stops at the daily cap」):顯示上限那個數', async () => {
    const r = await rig({ dailyCap: 3 });
    const reviews = existsSync(join(r.v.dir, 'state/reviews.json')) ? readReviews(r.v) : {};
    for (const id of ['sec-0001', 'sec-0002', 'sec-0003', 'lang-0001', 'lang-0002']) reviews[id] = reviewRecord({ next_due: TOMORROW });
    writeReviews(r.v, reviews);
    expect((await r.ok('teach.open')).load?.dueTomorrow).toBe(3);
    expect((await r.load()).dueTomorrow).toBe(3);
  });

  it('跟考試卡小結的「明天預估」同一個數(今天考試卡回退 2 張):teach.load 與 summary.tomorrow.shown 相等,手算是 4', async () => {
    const r = await rig();
    seedDue(r.v, ['sec-0001', 'sec-0002'], [0, 0]);
    const reviews = readReviews(r.v);
    reviews['lang-0001'] = reviewRecord({ next_due: TOMORROW });
    reviews['lang-0002'] = reviewRecord({ next_due: TOMORROW });
    writeReviews(r.v, reviews);
    await r.ok('start');
    const answered = await r.answerAllWrong();
    expect(answered, '佈置:兩張到期的都答錯').toBeGreaterThanOrEqual(2);
    const summary = (await r.ok('summary')) as Obj;
    expect(summary['returned']).toBe(2);
    const shown = (summary['tomorrow'] as Obj)['shown'];
    expect(shown).toBe(4);
    // 考試卡 session 還開著
    expect((await r.load()).dueTomorrow).toBe(shown);
    expect((await r.ok('teach.open')).load?.dueTomorrow).toBe(shown);
    // 側車重啟、沒有 session:讀磁碟上今天的快取(名單),一樣的數
    const fresh = await r.restart();
    expect((await fresh.load()).dueTomorrow).toBe(shown);
  });

  it('今天沒有考試卡的快取:名單當 [],沒有「回退」要扣,明天到期幾張就是幾張', async () => {
    const r = await rig();
    const reviews: Record<string, ReturnType<typeof reviewRecord>> = {};
    for (const id of ['sec-0001', 'sec-0002', 'sec-0003']) reviews[id] = reviewRecord({ next_due: TOMORROW });
    writeReviews(r.v, reviews);
    expect(existsSync(cachePath(r.v))).toBe(false);
    expect((await r.load()).dueTomorrow).toBe(3);
  });
});

describe('每個回應畫面的 teach.* 都帶 load', () => {
  it('teach.open / next / switch / prereq 的成功回應都有 load:{ learnedToday, dueTomorrow } 兩個整數', async () => {
    const r = await rig();
    const shapes: Obj[] = [];
    shapes.push(await r.ok('teach.open'));
    shapes.push(await r.ok('teach.next'));
    shapes.push(await r.ok('teach.switch', { category: 'language' }));
    shapes.push(await r.ok('teach.prereq', { index: 0 }));
    expect(shapes).toHaveLength(4);
    for (const result of shapes) {
      const load = result['load'] as Load | undefined;
      expect(load, JSON.stringify(result)).toBeDefined();
      expect(Object.keys(load!).sort()).toEqual(['dueTomorrow', 'learnedToday']);
      expect(Number.isInteger(load!.learnedToday) && load!.learnedToday >= 0).toBe(true);
      expect(Number.isInteger(load!.dueTomorrow) && load!.dueTomorrow >= 0).toBe(true);
    }
  });

  it('teach.deepen(已有子卡,直接進去)與 teach.back 的回應也有 load', async () => {
    const r = await deepRig({ children: 2 });
    await r.view('teach.open');
    const deeper = (await r.send('teach.deepen')) as Obj;
    expect((deeper['result'] as Obj)['load'], JSON.stringify(deeper)).toBeDefined();
    const back = (await r.send('teach.back')) as Obj;
    expect((back['result'] as Obj)['load'], JSON.stringify(back)).toBeDefined();
  });
});

describe('teach.load:只讀,而且不動畫面', () => {
  it('回應只有 learnedToday 與 dueTomorrow 兩個整數', async () => {
    const r = await rig();
    seedLearned(r.v, ['sec-0001']);
    const res = await r.send('teach.load');
    expect(res['ok']).toBe(true);
    const result = res['result'] as Obj;
    expect(Object.keys(result).sort()).toEqual(['dueTomorrow', 'learnedToday']);
    expect(result).toEqual({ learnedToday: 1, dueTomorrow: 1 });
  });

  it('不需要 start、不需要先 teach.open;也不因為考試卡暫停而出錯', async () => {
    const r = await rig();
    const res = await r.send('teach.load');
    expect(res['ok'], JSON.stringify(res)).toBe(true);
    expect(res['result']).toEqual({ learnedToday: 0, dueTomorrow: 0 });
  });

  it('params 一定是空物件:帶別的欄位是 bad-request', async () => {
    const r = await rig();
    for (const params of [{ category: 'language' }, { card: 'sec-0001' }, { x: 1 }]) {
      const res = await r.send('teach.load', params);
      expect(res['ok']).toBe(false);
      expect(errorKind(res), JSON.stringify(params)).toBe('bad-request');
    }
  });

  it('不寫 reviews.json、不寫 log.jsonl:位元組一樣(叫很多次)', async () => {
    const r = await rig();
    seedLearned(r.v, ['sec-0001', 'sec-0002'], ['lang-0001']);
    await r.ok('teach.open');
    const before = { reviews: reviewsText(r.v), log: logText(r.v), disk: diskHashes(r.v) };
    for (let i = 0; i < 3; i += 1) await r.load();
    expect(reviewsText(r.v)).toBe(before.reviews);
    expect(logText(r.v)).toBe(before.log);
    expect(diskHashes(r.v)).toEqual(before.disk);
  });

  it('沒有 order 檔的類別、其他會寫 warning 的情況,teach.load 自己不多寫一筆事件', async () => {
    const r = await rig();
    const before = logText(r.v);
    await r.load();
    await r.load();
    expect(logText(r.v)).toBe(before);
  });

  it('今天沒有考試卡快取時,叫完快取目錄還是沒有當日快取檔(也沒有為了算數字建出目錄)', async () => {
    const r = await rig();
    seedLearned(r.v, ['sec-0001'], []);
    const base = cacheBase(r.v);
    expect(tree(base), '佈置:一開始快取根不存在').toBeNull();
    await r.load();
    await r.ok('teach.open');
    await r.load();
    expect(existsSync(cachePath(r.v)), '不能為了算數字叫 openDay 建出當日快取').toBe(false);
    expect(tree(base)).toBeNull();
  });

  it('有今天的快取:叫完快取目錄的每個檔位元組一樣(不改)', async () => {
    const r = await rig();
    seedDue(r.v, ['sec-0001', 'sec-0002'], [0, 0]);
    await r.ok('start');
    const base = cacheBase(r.v);
    const before = tree(base);
    expect(before, '佈置:start 之後有快取').not.toBeNull();
    await r.load();
    const again = await r.restart();
    await again.load();
    await again.ok('teach.open');
    expect(tree(base)).toEqual(before);
  });

  it('快取壞掉(不是合法 JSON):不多寫 warning、不重建、不修,數字當名單是 []', async () => {
    const r = await rig();
    const reviews: Record<string, ReturnType<typeof reviewRecord>> = {};
    for (const id of ['sec-0001', 'sec-0002']) reviews[id] = reviewRecord({ next_due: TOMORROW });
    writeReviews(r.v, reviews);
    mkdirSync(join(cachePath(r.v), '..'), { recursive: true });
    writeFileSync(cachePath(r.v), '{這不是 JSON', 'utf8');
    const logBefore = logText(r.v);
    const res = await r.load();
    expect(res.dueTomorrow).toBe(2);
    expect(readFileSync(cachePath(r.v), 'utf8')).toBe('{這不是 JSON');
    expect(logText(r.v), '不叫 warnInvalidSessionCache(它會寫一筆 warning)').toBe(logBefore);
    await r.ok('teach.open');
    expect(logText(r.v)).toBe(logBefore);
  });

  it('快取是別天的(stale):不動它、不寫 warning', async () => {
    const r = await rig();
    seedDue(r.v, ['sec-0001'], [0]);
    await r.ok('start');
    const stalePath = cachePath(r.v, '2026-09-08');
    writeFileSync(stalePath, readFileSync(cachePath(r.v), 'utf8').replace(TODAY, '2026-09-08'), 'utf8');
    const before = tree(cacheBase(r.v));
    const logBefore = logText(r.v);
    const fresh = await r.restart();
    await fresh.load();
    expect(tree(cacheBase(r.v))).toEqual(before);
    expect(logText(r.v)).toBe(logBefore);
  });

  it('快取是別天的(stale):名單當 [],忽略它裡面今天回退的卡(C9:讀 stale 快取會多算 2)', async () => {
    const r = await rig();
    seedDue(r.v, ['sec-0001', 'sec-0002'], [0, 0]);
    await r.ok('start');
    expect(await r.answerAllWrong(), '佈置:兩張都答錯').toBeGreaterThanOrEqual(2);
    // 回退的兩張改成明天不到期、也沒有別的卡:有名單 → 先扣 0 再加回 2 = 2;名單是 [] → 0
    const reviews = readReviews(r.v);
    for (const id of ['sec-0001', 'sec-0002']) reviews[id] = { ...reviews[id]!, next_due: '2026-12-01' };
    writeReviews(r.v, reviews);
    const fresh = await r.restart();
    expect((await fresh.load()).dueTomorrow, '佈置:快取是今天的時候,回退的兩張算進去').toBe(2);
    const cache = JSON.parse(readFileSync(cachePath(r.v), 'utf8')) as Obj;
    writeFileSync(cachePath(r.v), JSON.stringify({ ...cache, date: '2026-09-08' }), 'utf8');
    expect(readFileSync(cachePath(r.v), 'utf8'), '佈置:快取的 date 真的被改成別天').toContain('2026-09-08');
    const after = await (await r.restart()).load();
    expect(after.dueTomorrow, 'stale 快取的名單要忽略').toBe(0);
  });

  it('不重存 reviews.json:檔案的修改時間與 inode 不變(C14:原封不動重存位元組一樣、時間會變)', async () => {
    const r = await rig();
    seedLearned(r.v, ['sec-0001', 'sec-0002'], ['lang-0001']);
    const path = join(r.v.dir, 'state/reviews.json');
    const old = new Date('2026-01-01T00:00:00Z');
    utimesSync(path, old, old);
    const before = statSync(path);
    await r.load();
    await r.ok('teach.open');
    await r.load();
    await (await r.restart()).load();
    const after = statSync(path);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(after.ino).toBe(before.ino);
  });

  it('不改畫面那張卡:open → load ×3 → next,跟 open → next 一樣(同一張卡、同樣的先備、同樣的類別清單)', async () => {
    const control = await rig();
    await control.ok('teach.open');
    const expected = await control.ok('teach.next');

    const probed = await rig();
    await probed.ok('teach.open');
    await probed.load();
    await probed.load();
    await probed.load();
    const actual = await probed.ok('teach.next');

    const strip = (view: Obj): Obj => ({ ...view, load: undefined });
    expect(strip(actual)).toEqual(strip(expected));
  });

  it('不改麵包屑:深入進子卡之後叫 teach.load,from / canBack 不變,teach.back 還是回父卡', async () => {
    const r = await deepRig({ children: 2 });
    await r.view('teach.open');
    const inside = await r.view('teach.deepen');
    expect(inside.canBack).toBe(true);
    const handlerSend = r.send;
    for (let i = 0; i < 3; i += 1) {
      const res = await handlerSend('teach.load');
      expect(res['ok'], JSON.stringify(res)).toBe(true);
    }
    const back = await r.view('teach.back');
    expect(back.card?.id).toBe('sec-0002');
    expect(back.canBack).toBe(false);
    expect(back.from).toBeNull();
  });
});

describe('空的 learning 目錄:兩個數都是 0,不出錯', () => {
  async function emptyRig(): Promise<Rig> {
    const v = createTeachVault();
    vaults.push(v);
    rmSync(join(v.dir, 'cards'), { recursive: true, force: true });
    mkdirSync(join(v.dir, 'cards'), { recursive: true });
    rmSync(join(v.dir, 'graph'), { recursive: true, force: true });
    rmSync(join(v.dir, 'state/reviews.json'), { force: true });
    return handlerFor(v, TODAY);
  }

  it('設定檔有類別、沒有卡、沒有 reviews.json:teach.load = { 0, 0 }', async () => {
    const r = await emptyRig();
    const res = await r.send('teach.load');
    expect(res['ok'], JSON.stringify(res)).toBe(true);
    expect(res['result']).toEqual({ learnedToday: 0, dueTomorrow: 0 });
  });

  it('teach.open 成功、card 是 null、load 是 0 / 0(不是 NaN、undefined)', async () => {
    const r = await emptyRig();
    const opened = await r.ok('teach.open');
    expect(opened['card']).toBeNull();
    expect(opened.load).toEqual({ learnedToday: 0, dueTomorrow: 0 });
    expect(JSON.stringify(opened)).not.toMatch(/NaN|undefined/);
  });

  it('有 reviews.json 但是 {}:一樣 0 / 0', async () => {
    const r = await emptyRig();
    writeReviews(r.v, {});
    expect(await r.load()).toEqual({ learnedToday: 0, dueTomorrow: 0 });
  });
});
