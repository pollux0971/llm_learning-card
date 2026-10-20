/**
 * T37:變異缺口補測(驗收 B2,G-b / G-c / G-d / G-f / G-g;G-a 在 t37-conflict.test.ts,G-e 在 deck.test.ts)。
 * 測試 agent 寫;開發 worker 不改。只看側車 handler 的回應與磁碟。
 *
 * G-b order 檔內容壞掉(不是字串陣列)→ 丟錯,側車回 internal,不當成 ok 吃進去
 * G-c teach.next / teach.prereq 在 teach.open 之前 → bad-request,什麼都不寫
 * G-d 沒有 order 檔的 warning 每個類別只記一次(同一個側車的生命期內)
 * G-f 卡片 frontmatter 的 title / prereqs 型別退路
 * G-g categories.yaml 沒有任何類別 → bad-request
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { childEnv } from './review-session-harness.js';
import {
  TODAY,
  createTeachVault,
  logText,
  removeVault,
  reviewsText,
  warningEvents,
  type TeachView,
  type TeachVaultOpts,
  type Vault,
} from './teach-harness.js';

const HANDLER = pathToFileURL(join(import.meta.dirname, '../../packages/core/src/session/handler.ts')).href;
type Obj = Record<string, unknown>;

const vaults: Vault[] = [];
afterAll(() => {
  for (const v of vaults) removeVault(v);
});

async function rig(opts: TeachVaultOpts = {}): Promise<{ v: Vault; send(method: string, params?: Obj): Promise<Obj>; teach(method: string, params?: Obj): Promise<TeachView> }> {
  const v = createTeachVault(opts);
  vaults.push(v);
  const mod = (await import(/* @vite-ignore */ HANDLER)) as { createReviewHandler(deps: Obj): (line: string) => Promise<string> };
  const handler = mod.createReviewHandler({ learningDir: v.dir, today: TODAY, routerFactory: () => ({}), env: childEnv(v) });
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
  return { v, send, teach };
}

const kind = (res: Obj): string => String((res.error as Obj | undefined)?.kind);

/** 把某張卡的 frontmatter 某一行換掉(換整行) */
function patchCard(v: Vault, category: string, id: string, line: RegExp, replacement: string): void {
  const path = join(v.dir, 'cards', category, `${id}.md`);
  const text = require_read(path);
  const next = text.replace(line, replacement);
  if (next === text) throw new Error(`patchCard: ${id} 沒有符合 ${String(line)} 的行`);
  writeFileSync(path, next, 'utf8');
}
const require_read = (p: string): string => readFileSync(p, 'utf8');

describe('G-b:order 檔內容壞掉就丟錯,不吃進去', () => {
  it('內容是物件(不是陣列):teach.open 回 internal,reviews.json 與 log.jsonl 不動', async () => {
    const r = await rig();
    writeFileSync(join(r.v.dir, 'graph/order-language.json'), '{"a":1}', 'utf8');
    const reviews = reviewsText(r.v);
    const log = logText(r.v);
    const res = await r.send('teach.open', { category: 'language' });
    expect(res.ok, JSON.stringify(res)).toBe(false);
    expect(kind(res)).toBe('internal');
    expect(reviewsText(r.v)).toBe(reviews);
    expect(logText(r.v)).toBe(log);
  });

  it('陣列裡混了不是字串的東西:同樣 internal(不是把數字當 id 排進牌堆)', async () => {
    const r = await rig();
    writeFileSync(join(r.v.dir, 'graph/order-language.json'), JSON.stringify(['lang-0003', 7, 'lang-0001']), 'utf8');
    const res = await r.send('teach.open', { category: 'language' });
    expect(res.ok).toBe(false);
    expect(kind(res)).toBe('internal');
  });

  it('壞檔不是「沒有檔」:不記 order 缺檔的 warning、也不退回照 id 排', async () => {
    const r = await rig();
    writeFileSync(join(r.v.dir, 'graph/order-language.json'), '"lang-0001"', 'utf8');
    const res = await r.send('teach.open', { category: 'language' });
    expect(kind(res)).toBe('internal');
    expect(warningEvents(r.v)).toEqual([]);
  });
});

describe('G-c:沒有 teach.open 就按 next / prereq → bad-request,什麼都不寫', () => {
  it('teach.next 在 teach.open 之前', async () => {
    const r = await rig();
    const reviews = reviewsText(r.v);
    const log = logText(r.v);
    const res = await r.send('teach.next');
    expect(res.ok).toBe(false);
    expect(kind(res)).toBe('bad-request');
    expect(reviewsText(r.v)).toBe(reviews);
    expect(logText(r.v)).toBe(log);
  });

  it('teach.prereq 在 teach.open 之前(index 0)', async () => {
    const r = await rig();
    const res = await r.send('teach.prereq', { index: 0 });
    expect(res.ok).toBe(false);
    expect(kind(res)).toBe('bad-request');
  });

  it('open 之後就正常(防護不是一律拒絕)', async () => {
    const r = await rig();
    await r.teach('teach.open');
    const res = await r.send('teach.next');
    expect(res.ok, JSON.stringify(res)).toBe(true);
  });
});

describe('G-d:缺 order 檔的 warning 每個類別只記一次', () => {
  it('同一個類別連按 next 好幾次:warning 還是一筆', async () => {
    const r = await rig();
    await r.teach('teach.open', { category: 'network' });
    await r.teach('teach.next');
    await r.teach('teach.next');
    expect(warningEvents(r.v)).toHaveLength(1);
  });

  it('重複 open 同一個類別、離開再回來:仍然一筆', async () => {
    const r = await rig();
    await r.teach('teach.open', { category: 'network' });
    await r.teach('teach.open', { category: 'network' });
    await r.teach('teach.switch', { category: 'language' });
    await r.teach('teach.switch', { category: 'network' });
    expect(warningEvents(r.v)).toHaveLength(1);
  });

  it('兩個缺檔的類別各記一筆(是「每類別」,不是「全域一筆」)', async () => {
    const r = await rig({ noOrder: ['security'] });
    await r.teach('teach.open', { category: 'network' });
    await r.teach('teach.switch', { category: 'security' });
    await r.teach('teach.next');
    await r.teach('teach.switch', { category: 'network' });
    const messages = warningEvents(r.v).map((e) => String(e.message));
    expect(messages).toHaveLength(2);
    expect(messages.some((m) => m.includes('network'))).toBe(true);
    expect(messages.some((m) => m.includes('security'))).toBe(true);
  });
});

describe('G-f:卡片 frontmatter 型別不對時的退路', () => {
  it('title 是空字串:標題退回卡片 id', async () => {
    const r = await rig();
    patchCard(r.v, 'network', 'net-0001', /^title:.*$/m, 'title: ""');
    const view = await r.teach('teach.open', { category: 'network' });
    expect(view.card?.id).toBe('net-0001');
    expect(view.card?.title).toBe('net-0001');
  });

  it('title 不是字串(數字):標題退回卡片 id', async () => {
    const r = await rig();
    patchCard(r.v, 'network', 'net-0001', /^title:.*$/m, 'title: 42');
    const view = await r.teach('teach.open', { category: 'network' });
    expect(view.card?.title).toBe('net-0001');
  });

  it('先備卡的 title 不見了:提示裡那一項的標題退回它的 id', async () => {
    const r = await rig();
    patchCard(r.v, 'language', 'lang-0001', /^title:.*$/m, 'title: ""');
    const view = await r.teach('teach.open', { category: 'language' });
    expect(view.card?.id).toBe('lang-0003');
    expect(view.prereqs.find((p) => p.id === 'lang-0001')?.title).toBe('lang-0001');
  });

  it('prereqs 不是陣列(寫成單一字串):當作沒有先備,不是錯誤', async () => {
    const r = await rig();
    patchCard(r.v, 'language', 'lang-0003', /^prereqs:.*$/m, 'prereqs: lang-0001');
    const view = await r.teach('teach.open', { category: 'language' });
    expect(view.card?.id).toBe('lang-0003');
    expect(view.prereqs).toEqual([]);
  });

  it('prereqs 陣列裡混了非字串:只留字串的那些(照原順序)', async () => {
    const r = await rig();
    patchCard(r.v, 'language', 'lang-0003', /^prereqs:.*$/m, 'prereqs: [5, lang-0002, true, lang-0001]');
    const view = await r.teach('teach.open', { category: 'language' });
    expect(view.prereqs.map((p) => p.id)).toEqual(['lang-0002', 'lang-0001']);
  });
});

describe('G-g:categories.yaml 沒有任何類別', () => {
  it('空檔:teach.open 回 bad-request,什麼都不寫', async () => {
    const r = await rig();
    writeFileSync(join(r.v.dir, 'config/categories.yaml'), '', 'utf8');
    const reviews = reviewsText(r.v);
    const log = logText(r.v);
    const res = await r.send('teach.open');
    expect(res.ok).toBe(false);
    expect(kind(res)).toBe('bad-request');
    expect(reviewsText(r.v)).toBe(reviews);
    expect(logText(r.v)).toBe(log);
  });

  it('只有一個壞掉的項目(缺 name):也等於沒有類別', async () => {
    const r = await rig();
    writeFileSync(join(r.v.dir, 'config/categories.yaml'), '- id: security\n', 'utf8');
    const res = await r.send('teach.open');
    expect(kind(res)).toBe('bad-request');
  });
});

describe('G-c(prereq):類別已學完、沒有目前卡時 teach.prereq → bad-request,不去讀不存在的卡', () => {
  it('network 三張都學過:open 後 card 是 null;teach.prereq 任何 index 都是 bad-request;reviews.json 與 log.jsonl 不動', async () => {
    const r = await rig({ learned: ['net-0001', 'net-0002', 'net-0003'] });
    const view = await r.teach('teach.open', { category: 'network' });
    expect(view.card).toBeNull();
    const reviews = reviewsText(r.v);
    const log = logText(r.v);
    for (const index of [0, 1]) {
      const res = await r.send('teach.prereq', { index });
      expect(res.ok, JSON.stringify(res)).toBe(false);
      expect(kind(res)).toBe('bad-request');
    }
    expect(reviewsText(r.v)).toBe(reviews);
    expect(logText(r.v)).toBe(log);
  });

  it('按 next 把最後一張學完之後(沒有目前卡):teach.prereq 一樣 bad-request', async () => {
    const r = await rig({ learned: ['net-0001', 'net-0002'] });
    await r.teach('teach.open', { category: 'network' });
    const done = await r.teach('teach.next');
    expect(done.card).toBeNull();
    const res = await r.send('teach.prereq', { index: 0 });
    expect(kind(res)).toBe('bad-request');
  });
});
