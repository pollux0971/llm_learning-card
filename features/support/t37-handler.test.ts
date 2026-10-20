/**
 * T37:側車 handler(`createReviewHandler`)的四個教學卡動作 `teach.open` / `teach.next` / `teach.switch` / `teach.prereq`
 * (ADR-077)。測試 agent 寫;開發 worker 不改。
 *
 * 看磁碟,不看畫面:每一條都讀 `state/reviews.json` 與 `state/log.jsonl`。
 * 世界與回應形狀見 `teach-harness.ts` 的檔頭。路由器、時鐘全是程序內的假物件:不打網路、不花錢。
 * 全部用暫存目錄(learning、XDG_*、HOME 同一個 mkdtemp),不碰真的 learning/。
 * handler 用算出來的 file URL 動態 import:基底上是「功能還沒有」而紅(unknown-method),不是 tsc 錯。
 *
 * 本來就綠(基底上已成立,守不退步):沒有。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { scriptedApplyReply } from '../steps/_i2-cloud-script.js';
import { NoModelError } from '../../packages/core/src/llm/errors.js';
import {
  LANGUAGE_ORDER,
  SECURITY_ORDER,
  TODAY,
  TOMORROW,
  cardPathOf,
  createTeachVault,
  freshLearned,
  learnedEvents,
  logText,
  readReviews,
  removeVault,
  reviewsText,
  titleOf,
  warningEvents,
  writeReviews,
  type Vault,
  type TeachView,
  type TeachVaultOpts,
} from './teach-harness.js';
import { childEnv } from './review-session-harness.js';

const ROOT = join(import.meta.dirname, '../..');
const HANDLER = pathToFileURL(join(ROOT, 'packages/core/src/session/handler.ts')).href;

type Obj = Record<string, unknown>;
type Handler = (line: string) => Promise<string>;

const vaults: Vault[] = [];
afterAll(() => {
  for (const v of vaults) removeVault(v);
});

function makeRouter(): { call(task: string, prompt: string): Promise<unknown>; probeOnline(): Promise<boolean>; probeLocal(): Promise<unknown> } {
  return {
    async call(task, prompt) {
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
  today: { value: string };
  send(method: string, params?: Obj): Promise<Obj>;
  /** teach.* 成功時回 result(形狀見 teach-harness) */
  teach(method: string, params?: Obj): Promise<TeachView>;
  /** 答考試卡一題(next + submit,不管對錯);回 submit 的整個回應 */
  answerOne(): Promise<Obj>;
}

async function rig(opts: TeachVaultOpts & { today?: string | (() => string) } = {}): Promise<Rig> {
  const v = createTeachVault(opts);
  vaults.push(v);
  const today = { value: typeof opts.today === 'string' ? opts.today : TODAY };
  const mod = (await import(/* @vite-ignore */ HANDLER)) as { createReviewHandler(deps: Obj): Handler };
  const handler = mod.createReviewHandler({
    learningDir: v.dir,
    today: typeof opts.today === 'function' ? opts.today : today.value,
    routerFactory: () => makeRouter(),
    env: childEnv(v),
  });
  let id = 0;
  const send = async (method: string, params: Obj = {}): Promise<Obj> => {
    id += 1;
    return JSON.parse(await handler(JSON.stringify({ v: 1, id, method, params }))) as Obj;
  };
  const teach = async (method: string, params: Obj = {}): Promise<TeachView> => {
    const res = await send(method, params);
    expect(res.ok, `${method} 應該成功:${JSON.stringify(res)}`).toBe(true);
    return res.result as unknown as TeachView;
  };
  const answerOne = async (): Promise<Obj> => {
    const q = (await send('next')).result as Obj;
    expect(q.kind, `next 應該給一題:${JSON.stringify(q)}`).toBe('question');
    const params = q.type === 'fill' ? { fill: Array.from({ length: Number(q.blanks) }, () => 'x') } : { apply: 'x' };
    return send('submit', params);
  };
  return { v, today, send, teach, answerOne };
}

const errorKind = (res: Obj): string => String((res.error as Obj | undefined)?.kind);
const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

describe('teach.open:讀、決定目前的類別與卡,什麼都不寫', () => {
  it('不帶類別:設定檔第一個類別;類別清單照設定檔順序,每個類別剩幾張、需不需要素材', async () => {
    const r = await rig();
    const before = { reviews: reviewsText(r.v), log: logText(r.v) };
    const view = await r.teach('teach.open');
    expect(view.category).toBe('security');
    expect(view.categories).toEqual([
      { id: 'security', name: '資安', remaining: 3, requireRaw: true },
      { id: 'language', name: '語言', remaining: 4, requireRaw: false },
      { id: 'network', name: '網路', remaining: 3, requireRaw: false },
    ]);
    expect(reviewsText(r.v)).toBe(before.reviews);
    expect(logText(r.v)).toBe(before.log);
  });

  it('目前卡是 order 檔的第一張(不是 id 最小的那張),只給相對路徑與標示;先備只點名沒學的', async () => {
    const r = await rig();
    const view = await r.teach('teach.open');
    expect(SECURITY_ORDER[0]).toBe('sec-0002');
    expect(view.card).toEqual({ id: 'sec-0002', path: 'cards/security/sec-0002.md', title: titleOf(r.v, 'sec-0002') });
    expect(view.prereqs).toEqual([{ id: 'sec-0001', title: titleOf(r.v, 'sec-0001') }]);
  });

  it('回應只有四個欄位,而且不送卡片內容', async () => {
    const r = await rig();
    const res = await r.send('teach.open');
    const result = res.result as Obj;
    expect(Object.keys(result).sort()).toEqual(['card', 'categories', 'category', 'prereqs']);
    expect(Object.keys(result.card as Obj).sort()).toEqual(['id', 'path', 'title']);
    expect(JSON.stringify(res)).not.toContain('的內文');
  });

  it('帶類別:回那個類別;兩個先備都沒學就兩個都點名,照卡片 frontmatter 的順序', async () => {
    const r = await rig();
    const view = await r.teach('teach.open', { category: 'language' });
    expect(view.category).toBe('language');
    expect(LANGUAGE_ORDER[0]).toBe('lang-0003');
    expect(view.card?.id).toBe('lang-0003');
    expect(view.card?.path).toBe(cardPathOf('lang-0003'));
    expect(view.prereqs.map((p) => p.id)).toEqual(['lang-0001', 'lang-0002']);
  });

  it('學過的先備不出現', async () => {
    const r = await rig({ learned: ['lang-0001'] });
    const view = await r.teach('teach.open', { category: 'language' });
    expect(view.card?.id).toBe('lang-0003');
    expect(view.prereqs.map((p) => p.id)).toEqual(['lang-0002']);
  });

  it('視窗記得的類別不在設定檔裡(含長得像路徑的):從第一個類別開始,不是錯誤', async () => {
    for (const category of ['nope', '../language', 'cards/language', '', 'LANGUAGE']) {
      const r = await rig();
      const res = await r.send('teach.open', { category });
      expect(res.ok, `category=${JSON.stringify(category)}:${JSON.stringify(res)}`).toBe(true);
      expect((res.result as TeachView).category, JSON.stringify(category)).toBe('security');
    }
  });

  it('已經有卡學過:剩幾張少一,目前卡是第一張沒學的', async () => {
    const r = await rig({ learned: ['sec-0002'] });
    const view = await r.teach('teach.open');
    expect(view.card?.id).toBe('sec-0003');
    expect(view.categories.find((c) => c.id === 'security')?.remaining).toBe(2);
  });

  it('類別全學過:card 是 null,先備是空陣列', async () => {
    const r = await rig({ learned: ['sec-0001', 'sec-0002', 'sec-0003'] });
    const view = await r.teach('teach.open');
    expect(view.card).toBeNull();
    expect(view.prereqs).toEqual([]);
    expect(view.categories.find((c) => c.id === 'security')?.remaining).toBe(0);
  });

  it('order 檔裡有、磁碟上沒有的卡略過;磁碟上有、order 檔沒列的排在最後', async () => {
    const r = await rig({ ghostInOrder: ['lang-0099'], extraLanguage: ['lang-0007', 'lang-0005'] });
    const seen: string[] = [];
    let view = await r.teach('teach.open', { category: 'language' });
    for (let i = 0; i < 9 && view.card; i += 1) {
      seen.push(view.card.id);
      view = await r.teach('teach.next');
    }
    expect(seen).toEqual(['lang-0003', 'lang-0001', 'lang-0004', 'lang-0002', 'lang-0005', 'lang-0007']);
    expect(view.card).toBeNull();
  });
});

describe('沒有 order 檔:照 id 排,而且記一筆 warning', () => {
  it('network 沒有 order 檔:第一張是 id 最小的;log.jsonl 多一筆 warning,提到那個類別、order、重跑 ingest', async () => {
    const r = await rig();
    const before = reviewsText(r.v);
    const view = await r.teach('teach.open', { category: 'network' });
    expect(view.card?.id).toBe('net-0001');
    const warnings = warningEvents(r.v);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ type: 'warning' });
    expect(String(warnings[0]!.ts)).toMatch(ISO_TS);
    const message = String(warnings[0]!.message);
    expect(message).toContain('network');
    expect(message).toMatch(/order/i);
    expect(message).toMatch(/ingest/i);
    expect(reviewsText(r.v)).toBe(before);
  });

  it('照 id 排下去:net-0001、net-0002、net-0003', async () => {
    const r = await rig();
    const seen: string[] = [];
    let view = await r.teach('teach.open', { category: 'network' });
    while (view.card) {
      seen.push(view.card.id);
      view = await r.teach('teach.next');
    }
    expect(seen).toEqual(['net-0001', 'net-0002', 'net-0003']);
  });

  it('有 order 檔的類別不記 warning', async () => {
    const r = await rig();
    await r.teach('teach.open', { category: 'language' });
    await r.teach('teach.open');
    expect(warningEvents(r.v)).toEqual([]);
  });

  it('把 security 的 order 檔也拿掉:security 照 id 排(sec-0001 先),也記 warning', async () => {
    const r = await rig({ noOrder: ['security'] });
    const view = await r.teach('teach.open');
    expect(view.card?.id).toBe('sec-0001');
    expect(warningEvents(r.v)).toHaveLength(1);
  });
});

describe('teach.next:把「目前顯示的那張」標成學過,寫進 reviews.json 與 log.jsonl', () => {
  it('標的是目前那張,不是 id 最小的;初始狀態 stage 1、學過日今天、明天到期;log 一行 learned', async () => {
    const r = await rig();
    await r.teach('teach.open');
    const view = await r.teach('teach.next');
    expect(readReviews(r.v)).toEqual({ 'sec-0002': freshLearned(TODAY, TOMORROW) });
    const events = learnedEvents(r.v);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'learned', card: 'sec-0002' });
    expect(String(events[0]!.ts)).toMatch(ISO_TS);
    expect(view.card?.id).toBe('sec-0003');
    expect(view.categories.find((c) => c.id === 'security')?.remaining).toBe(2);
  });

  it('reviews.json 的寫法跟 core 的 saveReviews 一樣(兩格縮排加結尾換行),沒有留下暫存檔', async () => {
    const r = await rig({ learned: ['sec-0001'] });
    await r.teach('teach.open');
    await r.teach('teach.next');
    const text = reviewsText(r.v);
    expect(text).toBe(`${JSON.stringify(JSON.parse(text), null, 2)}\n`);
    expect(existsSync(join(r.v.dir, 'state/reviews.json.tmp'))).toBe(false);
    expect(Object.keys(readReviews(r.v)).sort()).toEqual(['sec-0001', 'sec-0002']);
  });

  it('依 order 檔的順序連按:sec-0002、sec-0003、sec-0001,最後一次按完類別學完', async () => {
    const r = await rig();
    const shown: (string | undefined)[] = [];
    let view = await r.teach('teach.open');
    shown.push(view.card?.id);
    view = await r.teach('teach.next');
    shown.push(view.card?.id);
    view = await r.teach('teach.next');
    shown.push(view.card?.id);
    expect(shown).toEqual(['sec-0002', 'sec-0003', 'sec-0001']);
    view = await r.teach('teach.next');
    expect(view.card).toBeNull();
    expect(Object.keys(readReviews(r.v)).sort()).toEqual(['sec-0001', 'sec-0002', 'sec-0003']);
    expect(learnedEvents(r.v).map((e) => e.card)).toEqual(['sec-0002', 'sec-0003', 'sec-0001']);
  });

  it('學完之後再按 next:什麼都不寫,還是學完', async () => {
    const r = await rig({ learned: ['sec-0001', 'sec-0002', 'sec-0003'] });
    await r.teach('teach.open');
    const before = { reviews: reviewsText(r.v), log: logText(r.v) };
    const view = await r.teach('teach.next');
    expect(view.card).toBeNull();
    expect(reviewsText(r.v)).toBe(before.reviews);
    expect(logText(r.v)).toBe(before.log);
  });

  it('language 的 order:lang-0003、lang-0001、lang-0004、lang-0002', async () => {
    const r = await rig();
    const shown: string[] = [];
    let view = await r.teach('teach.open', { category: 'language' });
    while (view.card) {
      shown.push(view.card.id);
      view = await r.teach('teach.next');
    }
    expect(shown).toEqual(LANGUAGE_ORDER);
  });

  it('先備沒學不擋:顯示中的 sec-0002 有沒學的先備 sec-0001,照樣標成學過、前進', async () => {
    const r = await rig();
    const open = await r.teach('teach.open');
    expect(open.prereqs.map((p) => p.id)).toEqual(['sec-0001']);
    const view = await r.teach('teach.next');
    expect(readReviews(r.v)['sec-0002']).toEqual(freshLearned());
    expect(view.card?.id).toBe('sec-0003');
  });

  it('那張卡已經在 reviews.json(例如別的地方剛學過):它的 stage、學過日、下次到期、歷史一個字都不動,也不記 learned', async () => {
    const r = await rig();
    await r.teach('teach.open', { category: 'language' });
    const rich = {
      stage: 3,
      learned_at: '2026-08-01',
      next_due: '2026-09-30',
      fails_in_row: 1,
      total_fails: 2,
      stuck: false,
      history: [{ date: '2026-08-02', stage: 1, type: 'fill', pass: true, grader: 'exact' }],
    };
    writeReviews(r.v, { 'lang-0003': rich as never });
    const before = reviewsText(r.v);
    const view = await r.teach('teach.next');
    expect(reviewsText(r.v)).toBe(before);
    expect(learnedEvents(r.v)).toEqual([]);
    expect(view.card?.id).toBe('lang-0001');
  });

  it('別的地方在 open 之後加了一筆:teach.next 把它留著,自己那一筆也在(不蓋掉)', async () => {
    const r = await rig();
    await r.teach('teach.open');
    writeReviews(r.v, { 'zzz-0001': { ...freshLearned('2026-08-30', '2026-08-31'), stage: 2 } as never });
    await r.teach('teach.next');
    const reviews = readReviews(r.v);
    expect(Object.keys(reviews).sort()).toEqual(['sec-0002', 'zzz-0001']);
    expect(reviews['zzz-0001']?.stage).toBe(2);
    expect(reviews['sec-0002']).toEqual(freshLearned());
  });
});

describe('teach.switch:換類別也把目前那張標成學過', () => {
  it('標的是離開的那張;換到那個類別第一張沒學的;剩幾張跟著變', async () => {
    const r = await rig();
    await r.teach('teach.open');
    const view = await r.teach('teach.switch', { category: 'language' });
    expect(readReviews(r.v)).toEqual({ 'sec-0002': freshLearned() });
    expect(learnedEvents(r.v).map((e) => e.card)).toEqual(['sec-0002']);
    expect(view.category).toBe('language');
    expect(view.card?.id).toBe('lang-0003');
    expect(view.categories.map((c) => c.remaining)).toEqual([2, 4, 3]);
  });

  it('換到沒有 order 檔的類別:照 id 排,記 warning', async () => {
    const r = await rig();
    await r.teach('teach.open');
    const view = await r.teach('teach.switch', { category: 'network' });
    expect(view.card?.id).toBe('net-0001');
    expect(warningEvents(r.v)).toHaveLength(1);
  });

  it('換到已經學完的類別:card 是 null;離開的那張照樣標成學過', async () => {
    const r = await rig({ learned: ['net-0001', 'net-0002', 'net-0003'] });
    await r.teach('teach.open', { category: 'language' });
    const view = await r.teach('teach.switch', { category: 'network' });
    expect(view.card).toBeNull();
    expect(Object.keys(readReviews(r.v)).sort()).toEqual(['lang-0003', 'net-0001', 'net-0002', 'net-0003']);
  });

  it('離開的時候類別已經學完(沒有顯示中的卡):不寫東西', async () => {
    const r = await rig({ learned: ['sec-0001', 'sec-0002', 'sec-0003'] });
    await r.teach('teach.open');
    const before = { reviews: reviewsText(r.v), log: logText(r.v) };
    const view = await r.teach('teach.switch', { category: 'language' });
    expect(view.card?.id).toBe('lang-0003');
    expect(reviewsText(r.v)).toBe(before.reviews);
    expect(logText(r.v)).toBe(before.log);
  });
});

describe('teach.prereq:跟著提示走,原本那張不算學過', () => {
  it('顯示那個先備;reviews.json 與 log.jsonl 一個位元組都沒動', async () => {
    const r = await rig();
    await r.teach('teach.open');
    const before = { reviews: reviewsText(r.v), log: logText(r.v) };
    const view = await r.teach('teach.prereq', { index: 0 });
    expect(view.card).toEqual({ id: 'sec-0001', path: 'cards/security/sec-0001.md', title: titleOf(r.v, 'sec-0001') });
    expect(view.category).toBe('security');
    expect(reviewsText(r.v)).toBe(before.reviews);
    expect(logText(r.v)).toBe(before.log);
    expect(readReviews(r.v)['sec-0002']).toBeUndefined();
  });

  it('index 是未學先備清單的位置:第二個先備是 lang-0002', async () => {
    const r = await rig();
    await r.teach('teach.open', { category: 'language' });
    const view = await r.teach('teach.prereq', { index: 1 });
    expect(view.card?.id).toBe('lang-0002');
  });

  it('之後按 next:標的是先備那張(顯示中的那張),不是原本那張;回到第一張沒學的', async () => {
    const r = await rig();
    await r.teach('teach.open');
    await r.teach('teach.prereq', { index: 0 });
    const view = await r.teach('teach.next');
    expect(Object.keys(readReviews(r.v))).toEqual(['sec-0001']);
    expect(learnedEvents(r.v).map((e) => e.card)).toEqual(['sec-0001']);
    expect(view.card?.id).toBe('sec-0002');
    expect(view.prereqs).toEqual([]);
  });

  it('之後換類別:標的也是先備那張', async () => {
    const r = await rig();
    await r.teach('teach.open');
    await r.teach('teach.prereq', { index: 0 });
    await r.teach('teach.switch', { category: 'language' });
    expect(Object.keys(readReviews(r.v))).toEqual(['sec-0001']);
  });
});

describe('拒絕:不是設定檔裡的類別、超出範圍的先備序號 → bad-request,不讀不寫,狀態不變', () => {
  const BAD_CATEGORIES = ['nope', '', '../language', 'cards/language', '/etc', 'sec-0001', 'LANGUAGE', 'language ', 'language/..'];

  it('teach.switch 的類別不在設定檔:bad-request;reviews.json 與 log.jsonl 位元組不變;之後 next 標的還是原本那張', async () => {
    const r = await rig();
    await r.teach('teach.open');
    const before = { reviews: reviewsText(r.v), log: logText(r.v) };
    for (const category of BAD_CATEGORIES) {
      const res = await r.send('teach.switch', { category });
      expect(res.ok, `category=${JSON.stringify(category)}`).toBe(false);
      expect(errorKind(res), JSON.stringify(category)).toBe('bad-request');
      expect(reviewsText(r.v), JSON.stringify(category)).toBe(before.reviews);
      expect(logText(r.v), JSON.stringify(category)).toBe(before.log);
    }
    await r.teach('teach.next');
    expect(Object.keys(readReviews(r.v))).toEqual(['sec-0002']);
  });

  it('teach.prereq 的 index 超出範圍(目前那張只有一個未學先備):bad-request,什麼都不寫', async () => {
    const r = await rig();
    await r.teach('teach.open');
    const before = { reviews: reviewsText(r.v), log: logText(r.v) };
    for (const index of [1, 2, 99, 2 ** 31]) {
      const res = await r.send('teach.prereq', { index });
      expect(errorKind(res), `index=${index}`).toBe('bad-request');
    }
    expect(reviewsText(r.v)).toBe(before.reviews);
    expect(logText(r.v)).toBe(before.log);
    const view = await r.teach('teach.next');
    expect(view.card?.id).toBe('sec-0003');
  });

  it('目前那張沒有未學先備:teach.prereq 任何 index 都是 bad-request', async () => {
    const r = await rig();
    await r.teach('teach.open', { category: 'network' });
    expect(errorKind(await r.send('teach.prereq', { index: 0 }))).toBe('bad-request');
  });

  it('先備學過之後,清單縮短:原本合法的 index 變成超出範圍', async () => {
    const r = await rig({ learned: ['lang-0001', 'lang-0002'] });
    await r.teach('teach.open', { category: 'language' });
    expect(errorKind(await r.send('teach.prereq', { index: 0 }))).toBe('bad-request');
  });

  it('多出欄位、型別不對:bad-request(同樣不寫)', async () => {
    const r = await rig();
    await r.teach('teach.open');
    const before = { reviews: reviewsText(r.v), log: logText(r.v) };
    const cases: [string, Obj][] = [
      ['teach.next', { card: 'sec-0003' }],
      ['teach.next', { path: 'cards/security/sec-0003.md' }],
      ['teach.switch', {}],
      ['teach.switch', { category: 'language', card: 'lang-0001' }],
      ['teach.switch', { category: 5 }],
      ['teach.prereq', {}],
      ['teach.prereq', { index: '0' }],
      ['teach.prereq', { index: 0, card: 'sec-0001' }],
      ['teach.open', { path: 'cards/language/lang-0001.md' }],
    ];
    for (const [method, params] of cases) {
      const res = await r.send(method, params);
      expect(errorKind(res), `${method} ${JSON.stringify(params)}`).toBe('bad-request');
    }
    expect(reviewsText(r.v)).toBe(before.reviews);
    expect(logText(r.v)).toBe(before.log);
  });
});

describe('日期跟 session 同一個來源(D2 c)', () => {
  it('handler 的 today 釘一個不是今天的日期:learned_at 是那一天,next_due 是隔天', async () => {
    const r = await rig({ today: '2030-02-28' });
    await r.teach('teach.open');
    await r.teach('teach.next');
    expect(readReviews(r.v)['sec-0002']).toEqual(freshLearned('2030-02-28', '2030-03-01'));
  });

  it('today 是函式、考試卡 start 已經把這一輪的日子定住:之後函式換了日期,教學卡還是用 start 定的那一天', async () => {
    let now = '2026-09-10';
    const r = await rig({ learned: ['sec-0001', 'sec-0002', 'sec-0003'], today: () => now });
    expect((await r.send('start')).ok).toBe(true);
    now = '2026-09-20';
    await r.teach('teach.open', { category: 'language' });
    await r.teach('teach.next');
    expect(readReviews(r.v)['lang-0003']).toEqual(freshLearned('2026-09-10', '2026-09-11'));
  });

  it('today 是函式、沒有 start 過:每次都問函式(教學卡自己沒有另外一個時鐘)', async () => {
    let now = '2026-09-10';
    const r = await rig({ today: () => now });
    await r.teach('teach.open');
    now = '2026-09-12';
    await r.teach('teach.next');
    expect(readReviews(r.v)['sec-0002']).toEqual(freshLearned('2026-09-12', '2026-09-13'));
  });
});

describe('同一個側車裡考試卡與教學卡互不絆倒(D2 a、b)', () => {
  it('考試卡 start → 教學卡 teach.next → 考試卡 submit 成功,磁碟上兩筆都在', async () => {
    const r = await rig({ learned: ['sec-0001', 'sec-0002', 'sec-0003'] });
    expect((await r.send('start')).ok).toBe(true);
    await r.teach('teach.open', { category: 'language' });
    await r.teach('teach.next');
    const submit = await r.answerOne();
    expect(submit.ok, JSON.stringify(submit)).toBe(true);
    const reviews = readReviews(r.v);
    expect(reviews['lang-0003']).toEqual(freshLearned());
    const exam = Object.values(reviews).filter((rec) => rec.history.length > 0);
    expect(exam, '考試卡那一題的紀錄也在').toHaveLength(1);
  });

  it('考試卡 submit → 教學卡 teach.next 成功(教學卡沒有過期的基準)→ 考試卡再 submit 照樣成功,兩邊交錯三輪', async () => {
    const r = await rig({ learned: ['sec-0001', 'sec-0002', 'sec-0003'] });
    expect((await r.send('start')).ok).toBe(true);
    await r.teach('teach.open', { category: 'language' });
    for (let round = 0; round < 3; round += 1) {
      const submit = await r.answerOne();
      expect(submit.ok, `第 ${round + 1} 題 submit:${JSON.stringify(submit)}`).toBe(true);
      const view = await r.send('teach.next');
      expect(view.ok, `第 ${round + 1} 次 teach.next:${JSON.stringify(view)}`).toBe(true);
    }
    const reviews = readReviews(r.v);
    expect(Object.keys(reviews).filter((k) => k.startsWith('lang-')).sort()).toEqual(['lang-0001', 'lang-0003', 'lang-0004']);
    expect(Object.values(reviews).filter((rec) => rec.history.length > 0)).toHaveLength(3);
  });

  it('考試卡開著、教學卡標了一張:考試卡下一次送出不出現「複習紀錄剛被別的地方改過」', async () => {
    const r = await rig({ learned: ['sec-0001', 'sec-0002', 'sec-0003'] });
    await r.send('start');
    await r.teach('teach.open', { category: 'language' });
    await r.teach('teach.switch', { category: 'network' });
    const submit = await r.answerOne();
    expect(submit.ok, JSON.stringify(submit)).toBe(true);
  });

  it('外面(例如終端機)在 teach.open 之後改了 reviews.json:teach.next 成功、外面的改動還在、新卡也在;考試卡下一次送出照 T26 報錯', async () => {
    const r = await rig({ learned: ['sec-0001', 'sec-0002', 'sec-0003'] });
    await r.send('start');
    await r.teach('teach.open', { category: 'language' });
    const reviews = readReviews(r.v);
    writeReviews(r.v, { ...reviews, 'zzz-0001': { ...freshLearned('2026-08-30', '2026-08-31'), stage: 2 } as never });
    const next = await r.send('teach.next');
    expect(next.ok, JSON.stringify(next)).toBe(true);
    const after = readReviews(r.v);
    expect(after['zzz-0001']?.stage, '外面的改動還在').toBe(2);
    expect(after['lang-0003'], '教學卡那一筆也在').toEqual(freshLearned());
    const submit = await r.answerOne();
    expect(submit.ok).toBe(false);
    expect(errorKind(submit)).toBe('review-record-changed');
  });

  it('沒有開著的考試卡 session:teach.next 照常寫(不需要 start)', async () => {
    const r = await rig();
    const view = await r.teach('teach.open', { category: 'language' });
    expect(view.card?.id).toBe('lang-0003');
    await r.teach('teach.next');
    expect(Object.keys(readReviews(r.v))).toEqual(['lang-0003']);
  });
});

describe('log.jsonl 的 learned 事件(§10)', () => {
  it('reviews.json 有了才有 learned:每學一張一行,每行是完整的 JSON、有 ts / type / card', async () => {
    const r = await rig();
    await r.teach('teach.open');
    await r.teach('teach.next');
    await r.teach('teach.switch', { category: 'language' });
    const lines = logText(r.v).split('\n').filter((l) => l.trim() !== '');
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      const e = JSON.parse(line) as Obj;
      expect(e.type).toBe('learned');
      expect(String(e.ts)).toMatch(ISO_TS);
      expect(String(e.card)).toMatch(/^[a-z]{2,6}-\d{4}$/);
    }
    expect(logText(r.v).endsWith('\n')).toBe(true);
    expect(readFileSync(join(r.v.dir, 'state/log.jsonl'), 'utf8')).toBe(logText(r.v));
  });
});
