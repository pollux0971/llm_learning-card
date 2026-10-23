/**
 * T43(07 phase-3,深入這個):側車 handler(`createReviewHandler`)的 `teach.deepen` / `teach.poll`(ADR-079)。
 * 測試 agent 寫;開發 worker 不改。看磁碟,不看畫面:每一條都比對 `cards/` `questions/` `graph/` `state/reviews.json`
 * 的雜湊與 `state/log.jsonl`。世界、假 router、回應形狀見 `t43-harness.ts` 檔頭。
 *
 * 路由器是程序內的假物件(`FakeDeepenRouter`),每個呼叫記 task、prompt、opts:不打網路、不花錢。
 * 真 router 的帳(llm_call)由 cucumber 的側車子行程量(features/steps/teach-card-phase3.steps.ts)。
 * handler 用算出來的 file URL 動態 import:基底上是「功能還沒有」而紅(unknown-method),不是 tsc 錯。
 *
 * 本來就綠(基底上已成立,守不退步):沒有(整個動作組都還沒有)。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { parseCardText } from '../../packages/core/src/schema/parse-card.js';
import { validateQuestionFile } from '../../packages/core/src/schema/validate-question.js';
import { NoModelError } from '../../packages/core/src/llm/errors.js';
import {
  AFTER_PARENT,
  PARENT,
  PARENT_TITLE,
  SHORT_BODY,
  TODAY,
  candidates,
  cardFiles,
  cleanupRigs,
  deepRig,
  diskHashes,
  errorKind,
  errorMessage,
  logEvents,
  newIds,
  questionFiles,
  readCardText,
  readDeps,
  resultOf,
  type DeepView,
  type Obj,
} from './t43-harness.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

afterAll(cleanupRigs);

const BASE = ['sec-0001', 'sec-0002', 'sec-0003'];
const titleOfCard = (v: Parameters<typeof readCardText>[0], id: string): string => String((parseCardText(readCardText(v, id)).frontmatter as Record<string, unknown>)['title']);

/** 回應畫面都帶這三個欄位(T43 第 1 節);沒有麵包屑、沒有工作時的值 */
const PLAIN = { from: null, canBack: false, generating: false };

describe('TeachView 多三個欄位:from / canBack / generating(所有 teach.* 動作)', () => {
  it('teach.open / next / switch / prereq 的畫面都有這三個欄位,沒有深入時是 null / false / false', async () => {
    const r = await deepRig();
    const opened = await r.view('teach.open');
    expect(opened).toMatchObject(PLAIN);
    expect(opened.card?.id).toBe(PARENT);
    const switched = await r.view('teach.switch', { category: 'network' });
    expect(switched).toMatchObject(PLAIN);
    const back = await r.view('teach.switch', { category: 'security' });
    expect(back).toMatchObject(PLAIN);
    const next = await r.view('teach.next');
    expect(next).toMatchObject(PLAIN);
    expect(next.card?.id).toBe(AFTER_PARENT);
  });
});

describe('Scenario: Existing children are reused', () => {
  it('已有兩張子卡:teach.deepen 馬上回第一張(id 小的),from 是父卡、canBack,不打模型、磁碟一個位元組都沒變', async () => {
    const r = await deepRig({ children: 2 });
    await r.view('teach.open');
    const before = diskHashes(r.v);
    const logBefore = readFileSync(join(r.v.dir, 'state/log.jsonl'), 'utf8');
    const res = await r.send('teach.deepen');
    expect(res['ok'], JSON.stringify(res)).toBe(true);
    const view = resultOf(res);
    expect(view.card?.id).toBe('sec-0004');
    expect(view.card?.path).toBe('cards/security/sec-0004.md');
    expect(view.from).toEqual({ id: PARENT, title: PARENT_TITLE });
    expect(view.canBack).toBe(true);
    expect(view.generating).toBe(false);
    expect(r.router.calls).toHaveLength(0);
    expect(diskHashes(r.v)).toEqual(before);
    expect(readFileSync(join(r.v.dir, 'state/log.jsonl'), 'utf8'), '沒有 deepened、learned、warning 任何事件').toBe(logBefore);
  });

  it('子卡照 id 排,不照磁碟順序;學過的子卡也照樣顯示(從第一張開始)', async () => {
    const r = await deepRig({ children: 2, learned: ['sec-0001', 'sec-0004'] });
    await r.view('teach.open');
    const view = await r.view('teach.deepen');
    expect(view.card?.id).toBe('sec-0004');
  });

  it('只算 parent 是這一張的卡:別張卡的子卡、別的 level 的卡不混進來', async () => {
    const r = await deepRig({ children: 2, grandchildren: 2 });
    await r.view('teach.open');
    const first = await r.view('teach.deepen');
    expect(first.card?.id).toBe('sec-0004');
    // 孫卡(parent 是 sec-0004)是再深入一層才出現
    const second = await r.view('teach.deepen');
    expect(second.card?.id).toBe('sec-0006');
    expect(second.from).toEqual({ id: 'sec-0004', title: '子卡1' });
    expect(r.router.calls).toHaveLength(0);
  });

  it('子卡的畫面不列麵包屑上的父卡當先備(父卡沒學過,但你剛從它下來)', async () => {
    const r = await deepRig({ children: 2 });
    await r.view('teach.open');
    const view = await r.view('teach.deepen');
    // sec-0004 的 prereqs 是 [sec-0002],sec-0002 沒學過
    expect(view.prereqs.map((p) => p.id)).not.toContain(PARENT);
    expect(view.prereqs).toEqual([]);
  });
});

describe('Scenario: Children are generated when there are none(@llm,這裡用假 router)', () => {
  it('teach.deepen 馬上回(生成在背景):畫面還是原本那張,generating: true;子卡的呼叫被攔住也一樣', async () => {
    const r = await deepRig();
    await r.view('teach.open');
    const gate = r.router.hold((c) => c.kind === 'children');
    const res = await Promise.race([
      r.send('teach.deepen'),
      new Promise<Obj>((resolve) => setTimeout(() => resolve({ timedOut: true }), 1500)),
    ]);
    expect(res['timedOut'], '請求不能握著側車等生成結束').toBeUndefined();
    expect(res['ok']).toBe(true);
    const view = resultOf(res);
    expect(view.generating).toBe(true);
    expect(view.card?.id).toBe(PARENT);
    expect(view.canBack).toBe(false);
    await gate.reached;
    gate.release();
    await r.pollDone();
  });

  it('生成中 teach.poll 馬上回目前畫面 + generating: true,不寫任何檔', async () => {
    const r = await deepRig();
    await r.view('teach.open');
    const before = diskHashes(r.v);
    const gate = r.router.hold((c) => c.kind === 'children');
    await r.send('teach.deepen');
    await gate.reached;
    for (let i = 0; i < 3; i += 1) {
      const res = await r.send('teach.poll');
      expect(res['ok']).toBe(true);
      expect(resultOf(res).generating).toBe(true);
      expect(resultOf(res).card?.id).toBe(PARENT);
    }
    expect(diskHashes(r.v)).toEqual(before);
    gate.release();
    await r.pollDone();
  });

  it.each([1, 2, 3])('生出 %i 張:磁碟上是 level 2、parent、source llm、provisional false、先備是父卡;每張有過驗證的考題檔', async (n) => {
    const r = await deepRig({ setup: (router) => { router.children = () => candidates(n); } });
    await r.view('teach.open');
    await r.send('teach.deepen');
    const done = await r.pollDone();
    expect(done['ok'], JSON.stringify(done)).toBe(true);
    const ids = newIds(n);
    expect(cardFiles(r.v)).toEqual(['sec-0001', 'sec-0002', 'sec-0003', ...ids]);
    expect(questionFiles(r.v)).toEqual(expect.arrayContaining(ids));
    for (const [i, id] of ids.entries()) {
      const fm = parseCardText(readCardText(r.v, id)).frontmatter as Record<string, unknown>;
      expect(fm['id'], id).toBe(id);
      expect(fm['category']).toBe('security');
      expect(fm['title']).toBe(`新卡${i + 1}`);
      expect(fm['level']).toBe(2);
      expect(fm['source']).toBe('llm');
      expect(fm['parent']).toBe(PARENT);
      expect(fm['prereqs']).toEqual([PARENT]);
      expect(fm['provisional']).toBe(false);
      expect(fm['stale']).toBe(false);
      expect(fm['source_missing']).toBe(false);
      expect(String(fm['created']), 'created 是側車的今天').toBe(TODAY);
      const q = parseYaml(readFileSync(join(r.v.dir, 'questions', `${id}.yaml`), 'utf8')) as unknown;
      expect(validateQuestionFile(q).ok, `${id} 的考題檔`).toBe(true);
      expect((q as { card: string }).card).toBe(id);
    }
  });

  it('成功的 poll:畫面是第一張新卡、from 是父卡、canBack;只回一次,下一次 poll 是同一個畫面但沒有工作', async () => {
    const r = await deepRig();
    await r.view('teach.open');
    await r.send('teach.deepen');
    const done = await r.pollDone();
    const view = resultOf(done);
    expect(view.card?.id).toBe('sec-0004');
    expect(view.card?.path).toBe('cards/security/sec-0004.md');
    expect(view.from).toEqual({ id: PARENT, title: PARENT_TITLE });
    expect(view.canBack).toBe(true);
    expect(view.generating).toBe(false);
    const again = await r.send('teach.poll');
    expect(again['ok']).toBe(true);
    expect(resultOf(again).card?.id, '沒有工作:目前畫面,仍是第一張新卡').toBe('sec-0004');
    expect(resultOf(again).generating).toBe(false);
  });

  it('deps.json:這個分類的圖多了每張新卡的節點與 [父卡, 子卡] 的邊;別的分類的圖、order 檔不動', async () => {
    const r = await deepRig({ setup: (router) => { router.children = () => candidates(3); } });
    await r.view('teach.open');
    const depsBefore = readDeps(r.v);
    const orderBefore = readFileSync(join(r.v.dir, 'graph/order-security.json'), 'utf8');
    await r.send('teach.deepen');
    await r.pollDone();
    const deps = readDeps(r.v);
    const ids = newIds(3);
    expect(deps['security']!.nodes).toEqual([...depsBefore['security']!.nodes, ...ids]);
    expect(deps['security']!.edges).toEqual([...depsBefore['security']!.edges, ...ids.map((id) => [PARENT, id])]);
    expect(deps['network'], '別的分類的圖一個字都沒動').toEqual(depsBefore['network']);
    expect(readFileSync(join(r.v.dir, 'graph/order-security.json'), 'utf8'), '不動 order 檔(主流程本來就不排 level 2 以上)').toBe(orderBefore);
  });

  it('一次深入的每一個呼叫都是 task deepen(子卡、考題):沒有 ingest.cards / ingest.questions', async () => {
    const r = await deepRig({ setup: (router) => { router.children = () => candidates(2); } });
    await r.view('teach.open');
    await r.send('teach.deepen');
    await r.pollDone();
    expect(r.router.calls.map((c) => c.kind)).toEqual(['children', 'questions', 'questions']);
    expect(r.router.calls.map((c) => c.task)).toEqual(['deepen', 'deepen', 'deepen']);
  });

  it('考題的呼叫明講 maxTokens = ingest.questions 的表格值(4096),不是 deepen 的 2048', async () => {
    const r = await deepRig();
    await r.view('teach.open');
    await r.send('teach.deepen');
    await r.pollDone();
    const q = r.router.of('questions');
    expect(q.length).toBeGreaterThan(0);
    for (const c of q) expect(c.opts?.['maxTokens'], `考題 ${c.card}`).toBe(4096);
  });

  it('log.jsonl 記一筆 deepened:{ card: 父卡, children: [新卡 id], provisional, skipped }(沒有略過 → skipped 0);不記 learned', async () => {
    const r = await deepRig({ setup: (router) => { router.children = () => candidates(2); } });
    await r.view('teach.open');
    await r.send('teach.deepen');
    await r.pollDone();
    const events = logEvents(r.v, 'deepened');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'deepened', card: PARENT, children: newIds(2), provisional: false, skipped: 0 });
    expect(typeof events[0]!['ts']).toBe('string');
    expect(logEvents(r.v, 'learned')).toEqual([]);
    expect(logEvents(r.v, 'warning')).toEqual([]);
  });

  it('深入不寫 state/reviews.json:誰記學過看麵包屑規則,生成當下一筆都不加', async () => {
    const r = await deepRig();
    await r.view('teach.open');
    const reviewsBefore = readFileSync(join(r.v.dir, 'state/reviews.json'), 'utf8');
    await r.send('teach.deepen');
    await r.pollDone();
    expect(readFileSync(join(r.v.dir, 'state/reviews.json'), 'utf8')).toBe(reviewsBefore);
  });

  it('子卡的 prompt 用的是父卡(parent_id 是目前那張),考題的 prompt 帶新卡 id', async () => {
    const r = await deepRig({ setup: (router) => { router.children = () => candidates(1); } });
    await r.view('teach.open');
    await r.send('teach.deepen');
    await r.pollDone();
    expect(r.router.of('children')[0]!.card).toBe(PARENT);
    expect(r.router.of('questions')[0]!.card).toBe('sec-0004');
  });

  it('生成完之後同一張再按深入:這次是「已有子卡」,不再打模型', async () => {
    const r = await deepRig();
    await r.view('teach.open');
    await r.send('teach.deepen');
    await r.pollDone();
    await r.view('teach.back');
    const callsBefore = r.router.calls.length;
    const again = await r.view('teach.deepen');
    expect(again.card?.id).toBe('sec-0004');
    expect(r.router.calls).toHaveLength(callsBefore);
  });
});

describe('Scenario: Offline generation falls back and is marked(provisional)', () => {
  it('每個呼叫都是本機(provisional: true):每張新卡 provisional: true,log 的 deepened.provisional 也是 true', async () => {
    const r = await deepRig({
      setup: (router) => {
        router.children = () => candidates(2);
        router.provisionalOf = () => true;
      },
    });
    await r.view('teach.open');
    await r.send('teach.deepen');
    const done = await r.pollDone();
    expect(done['ok']).toBe(true);
    for (const id of newIds(2)) {
      expect((parseCardText(readCardText(r.v, id)).frontmatter as Record<string, unknown>)['provisional'], id).toBe(true);
    }
    expect(logEvents(r.v, 'deepened')[0]).toMatchObject({ provisional: true });
  });

  it('只有其中一張的考題是本機的:那一張算 provisional,另一張不算(任何一個呼叫是本機,這張就是)', async () => {
    const r = await deepRig({
      setup: (router) => {
        router.children = () => candidates(2);
        router.provisionalOf = (c) => c.kind === 'questions' && c.title === '新卡2';
      },
    });
    await r.view('teach.open');
    await r.send('teach.deepen');
    await r.pollDone();
    const fm = (id: string): Record<string, unknown> => parseCardText(readCardText(r.v, id)).frontmatter as Record<string, unknown>;
    expect(fm('sec-0004')['provisional']).toBe(false);
    expect(fm('sec-0005')['provisional']).toBe(true);
  });

  it('只有字數重寫的那個呼叫是本機的:那一張算 provisional', async () => {
    const r = await deepRig({
      setup: (router) => {
        router.children = () => [{ title: '新卡1', body: Array.from({ length: 101 }, (_, i) => `w${i}`).join(' '), examples: [] }, ...candidates(2).slice(1)];
        router.provisionalOf = (c) => c.kind === 'regenerate';
        router.regenerate = () => [{ title: '', body: SHORT_BODY, examples: [] }];
      },
    });
    await r.view('teach.open');
    await r.send('teach.deepen');
    await r.pollDone();
    const fm = (id: string): Record<string, unknown> => parseCardText(readCardText(r.v, id)).frontmatter as Record<string, unknown>;
    expect(fm('sec-0004')['provisional']).toBe(true);
    expect(fm('sec-0005')['provisional']).toBe(false);
  });

  it('只有子卡那個呼叫是本機的(考題是雲端):新卡也算 provisional(用到的任何一個呼叫)', async () => {
    const r = await deepRig({
      setup: (router) => {
        router.children = () => candidates(1);
        router.provisionalOf = (c) => c.kind === 'children';
      },
    });
    await r.view('teach.open');
    await r.send('teach.deepen');
    await r.pollDone();
    expect((parseCardText(readCardText(r.v, 'sec-0004')).frontmatter as Record<string, unknown>)['provisional']).toBe(true);
  });
});

describe('Scenario: No model at all is reported plainly', () => {
  it('子卡那個呼叫丟 NoModelError:poll 回 no-model + 固定字樣;畫面是原本那張;磁碟一個位元組都沒變;沒有 deepened', async () => {
    const r = await deepRig({
      setup: (router) => {
        router.children = new NoModelError('deepen');
      },
    });
    await r.view('teach.open');
    const before = diskHashes(r.v);
    const started = await r.send('teach.deepen');
    expect(started['ok'], 'deepen 本身只是開工,錯誤從 poll 來').toBe(true);
    const done = await r.pollDone();
    expect(done['ok']).toBe(false);
    expect(errorKind(done)).toBe('no-model');
    expect(errorMessage(done)).toBe('現在沒辦法產生新卡:連不上雲端,也沒有可用的本機模型。');
    expect(diskHashes(r.v)).toEqual(before);
    expect(logEvents(r.v, 'deepened')).toEqual([]);
    const after = await r.view('teach.poll');
    expect(after.card?.id, '還是原本那張').toBe(PARENT);
    expect(after.generating).toBe(false);
    expect(after.canBack).toBe(false);
    expect(await r.view('teach.next'), '之後教學卡照常能用').toMatchObject({ card: { id: AFTER_PARENT } });
  });

  it('錯誤只回一次:下一次 poll 是目前畫面', async () => {
    const r = await deepRig({ setup: (router) => { router.children = new NoModelError('deepen'); } });
    await r.view('teach.open');
    await r.send('teach.deepen');
    expect((await r.pollDone())['ok']).toBe(false);
    const again = await r.send('teach.poll');
    expect(again['ok']).toBe(true);
    expect(resultOf(again).card?.id).toBe(PARENT);
  });

  it('只有某一張的考題丟 NoModelError:略過那一張,其他照留(不是整批 no-model)', async () => {
    const r = await deepRig({
      setup: (router) => {
        router.children = () => candidates(2);
        router.questions = (_card, title) => (title === '新卡1' ? new NoModelError('deepen') : JSON.stringify({ fill: [{ prompt: '同源的判定條件是 ___、___ 兩者相同。', answers: [['協定'], ['主機']] }, { prompt: 'a 和 b 是否同源?___', answers: [['否']] }], apply: [{ prompt: '前端跨來源呼叫 API 會遇到什麼問題?', rubric: ['有指出這是跨來源請求', '有提到需要伺服器端設定允許'] }] }));
      },
    });
    await r.view('teach.open');
    await r.send('teach.deepen');
    const done = await r.pollDone();
    expect(done['ok'], JSON.stringify(done)).toBe(true);
    const created = cardFiles(r.v).filter((id) => !BASE.includes(id));
    expect(created, '只留下考題沒問題的那一張').toHaveLength(1);
    expect(titleOfCard(r.v, created[0]!)).toBe('新卡2');
  });
});

describe('Scenario: There is a floor to how deep it goes', () => {
  it('目前那張是 level 4:deepen-floor + 固定字樣,不打模型、磁碟不變、log 不變', async () => {
    const r = await deepRig({ chain: true });
    await r.view('teach.open');
    await r.view('teach.deepen'); // sec-0004 level 2
    await r.view('teach.deepen'); // sec-0005 level 3
    const l4 = await r.view('teach.deepen'); // sec-0006 level 4
    expect(l4.card?.id).toBe('sec-0006');
    const before = diskHashes(r.v);
    const logBefore = readFileSync(join(r.v.dir, 'state/log.jsonl'), 'utf8');
    const res = await r.send('teach.deepen');
    expect(res['ok']).toBe(false);
    expect(errorKind(res)).toBe('deepen-floor');
    expect(errorMessage(res)).toBe('這張已經是最深的一層了。');
    expect(r.router.calls).toHaveLength(0);
    expect(diskHashes(r.v)).toEqual(before);
    expect(readFileSync(join(r.v.dir, 'state/log.jsonl'), 'utf8')).toBe(logBefore);
    const still = await r.view('teach.poll');
    expect(still.card?.id, '卡片還在').toBe('sec-0006');
    expect(still.generating).toBe(false);
  });

  it('level 3 還可以深入:不是 off-by-one(level 3 沒有子卡 → 開工,不是 deepen-floor)', async () => {
    const r = await deepRig({ chain: true });
    await r.view('teach.open');
    await r.view('teach.deepen');
    await r.view('teach.deepen'); // sec-0005 level 3,有子卡 sec-0006
    const res = await r.send('teach.deepen');
    expect(res['ok'], JSON.stringify(res)).toBe(true);
    expect(resultOf(res).card?.id).toBe('sec-0006');
  });
});

describe('不合狀態的請求:bad-request,不讀不寫', () => {
  it('還沒 teach.open 就按 deepen / poll / cancel / back:deepen 與 back 是 bad-request;poll 與 cancel 沒有工作不是錯', async () => {
    const r = await deepRig();
    const before = diskHashes(r.v);
    expect(errorKind(await r.send('teach.deepen'))).toBe('bad-request');
    expect(errorKind(await r.send('teach.back'))).toBe('bad-request');
    expect(r.router.calls).toHaveLength(0);
    expect(diskHashes(r.v)).toEqual(before);
  });

  it('類別學完了(card 是 null)還按深入:bad-request,不打模型', async () => {
    const r = await deepRig({ learned: ['sec-0001', 'sec-0002', 'sec-0003'] });
    const opened = await r.view('teach.open');
    expect(opened.card).toBeNull();
    const res = await r.send('teach.deepen');
    expect(res['ok']).toBe(false);
    expect(errorKind(res)).toBe('bad-request');
    expect(r.router.calls).toHaveLength(0);
  });

  it('沒有麵包屑還按「回上一層」:bad-request,磁碟不變', async () => {
    const r = await deepRig();
    await r.view('teach.open');
    const before = diskHashes(r.v);
    const res = await r.send('teach.back');
    expect(errorKind(res)).toBe('bad-request');
    expect(diskHashes(r.v)).toEqual(before);
    expect((await r.view('teach.poll')).card?.id).toBe(PARENT);
  });

  it('沒有工作時 teach.poll 與 teach.cancel 回目前畫面(不是錯誤),不寫檔', async () => {
    const r = await deepRig();
    await r.view('teach.open');
    const before = diskHashes(r.v);
    for (const method of ['teach.poll', 'teach.cancel']) {
      const res = await r.send(method);
      expect(res['ok'], method).toBe(true);
      expect(resultOf(res), method).toMatchObject({ ...PLAIN, card: { id: PARENT } });
    }
    expect(diskHashes(r.v)).toEqual(before);
  });

  it('四個新動作不收參數:帶 path / card / job 都是 bad-request(信封 strict),而且不開工', async () => {
    const r = await deepRig();
    await r.view('teach.open');
    for (const [method, params] of [
      ['teach.deepen', { card: 'sec-0002' }],
      ['teach.deepen', { path: 'cards/security/sec-0002.md' }],
      ['teach.poll', { job: 1 }],
      ['teach.cancel', { job: 1 }],
      ['teach.back', { card: 'sec-0001' }],
    ] as const) {
      const res = await r.send(method, params);
      expect(errorKind(res), `${method} ${JSON.stringify(params)}`).toBe('bad-request');
    }
    expect(r.router.calls).toHaveLength(0);
  });
});

describe('開工前的檢查(照 start / submit 的做法)', () => {
  it('每次 deepen 先重讀 .env(reloadEnv);回 true(內容變了)就丟掉舊 router、重建', async () => {
    let reloads = 0;
    let built = 0;
    const r = await deepRig({
      reloadEnv: () => {
        reloads += 1;
        return true;
      },
      routerFactory: () => {
        built += 1;
        return r.router;
      },
    });
    await r.view('teach.open');
    await r.send('teach.deepen');
    await r.pollDone();
    expect(reloads).toBeGreaterThanOrEqual(1);
    expect(built).toBe(1);
  });

  it('金鑰缺了:deepen 當場回 credential-unavailable + 深入自己的字樣(鍵名照 env),不開工、不打模型', async () => {
    const r = await deepRig({ missingKeys: () => ['OPENAI_API_KEY'] });
    await r.view('teach.open');
    const before = diskHashes(r.v);
    const res = await r.send('teach.deepen');
    expect(res['ok']).toBe(false);
    expect(errorKind(res)).toBe('credential-unavailable');
    expect(errorMessage(res)).toBe('產生新卡要用的金鑰沒有設定:OPENAI_API_KEY。請在專案根目錄的 .env 加上。');
    expect(errorMessage(res), '不是批改那句').not.toContain('批改');
    expect(r.router.calls).toHaveLength(0);
    expect(diskHashes(r.v)).toEqual(before);
    expect((await r.view('teach.poll')).generating).toBe(false);
  });

  it('金鑰被拒絕(呼叫丟 401):poll 回 credential-unavailable + 深入自己的第二句,不寫檔', async () => {
    const r = await deepRig({
      setup: (router) => {
        router.children = Object.assign(new Error('401 Unauthorized'), { status: 401 });
      },
    });
    await r.view('teach.open');
    const before = diskHashes(r.v);
    await r.send('teach.deepen');
    const done = await r.pollDone();
    expect(errorKind(done)).toBe('credential-unavailable');
    expect(errorMessage(done)).toBe('產生新卡用的金鑰被拒絕:OPENAI_API_KEY(可能過期或打錯)。請在專案根目錄的 .env 換一個。');
    expect(diskHashes(r.v)).toEqual(before);
  });

  it('已有子卡時不查金鑰、不拿 router:缺金鑰也能顯示子卡', async () => {
    const r = await deepRig({ children: 2, missingKeys: () => ['OPENAI_API_KEY'] });
    await r.view('teach.open');
    const res = await r.send('teach.deepen');
    expect(res['ok'], JSON.stringify(res)).toBe(true);
    expect(resultOf(res).card?.id).toBe('sec-0004');
  });

  it('router 建不起來(帳本不可用):deepen 回 router-unavailable;指標不符:root-mismatch;都不開工', async () => {
    const mod = (await import(/* @vite-ignore */ new URL('../../packages/core/src/session/handler.ts', import.meta.url).href)) as { ReviewStartError: new (k: 'root-mismatch' | 'router-unavailable') => Error };
    for (const kind of ['router-unavailable', 'root-mismatch'] as const) {
      const r = await deepRig({
        routerFactory: () => {
          throw new mod.ReviewStartError(kind);
        },
      });
      await r.view('teach.open');
      const res = await r.send('teach.deepen');
      expect(res['ok'], kind).toBe(false);
      expect(errorKind(res), kind).toBe(kind);
      expect((await r.view('teach.poll')).generating, kind).toBe(false);
    }
  });
});

describe('工作自己的錯一律接住:變成 poll 的錯誤種類,側車不結束、教學卡之後照常', () => {
  it('子卡的回應不是合法 JSON → deepen-failed + 固定字樣,磁碟不變', async () => {
    const r = await deepRig({ setup: (router) => { router.children = '這不是 JSON'; } });
    await r.view('teach.open');
    const before = diskHashes(r.v);
    await r.send('teach.deepen');
    const done = await r.pollDone();
    expect(errorKind(done)).toBe('deepen-failed');
    expect(errorMessage(done)).toBe('這次沒有產生出能用的卡。可以再按一次「深入這個」。');
    expect(diskHashes(r.v)).toEqual(before);
    expect(logEvents(r.v, 'deepened')).toEqual([]);
    expect((await r.view('teach.next')).card?.id).toBe(AFTER_PARENT);
  });

  it.each([0, 4])('子卡的回應筆數是 %i(不在 1 到 3):deepen-failed,不寫任何檔', async (n) => {
    const r = await deepRig({ setup: (router) => { router.children = () => candidates(n); } });
    await r.view('teach.open');
    const before = diskHashes(r.v);
    await r.send('teach.deepen');
    expect(errorKind(await r.pollDone())).toBe('deepen-failed');
    expect(diskHashes(r.v)).toEqual(before);
    expect(r.router.of('questions'), '回應不合格式就不再出考題').toHaveLength(0);
  });

  it('子卡的回應欄位不對(缺 body):deepen-failed', async () => {
    const r = await deepRig({ setup: (router) => { router.children = JSON.stringify([{ title: 'x', examples: [] }]); } });
    await r.view('teach.open');
    await r.send('teach.deepen');
    expect(errorKind(await r.pollDone())).toBe('deepen-failed');
  });

  it('呼叫丟一般的錯(不是 NoModel、不是 401):接住,不讓 handler 丟錯;poll 回一個固定種類的錯,之後 teach.next 照常', async () => {
    const r = await deepRig({ setup: (router) => { router.children = new Error('boom: 內部細節不該外洩'); } });
    await r.view('teach.open');
    const started = await r.send('teach.deepen');
    expect(started['ok']).toBe(true);
    const done = await r.pollDone();
    expect(done['ok']).toBe(false);
    expect(['deepen-failed', 'internal']).toContain(errorKind(done));
    expect(JSON.stringify(done), '例外原文不出側車').not.toContain('boom');
    expect((await r.view('teach.next')).card?.id).toBe(AFTER_PARENT);
  });

  it('一張卡的考題丟一般的錯:略過那一張(不是整批失敗)', async () => {
    const r = await deepRig({
      setup: (router) => {
        router.children = () => candidates(3);
        router.questions = (_c, title) => (title === '新卡2' ? new Error('boom') : JSON.stringify({ fill: [{ prompt: '同源的判定條件是 ___、___ 兩者相同。', answers: [['協定'], ['主機']] }, { prompt: 'a 和 b 是否同源?___', answers: [['否']] }], apply: [{ prompt: '前端跨來源呼叫 API 會遇到什麼問題?', rubric: ['有指出這是跨來源請求', '有提到需要伺服器端設定允許'] }] }));
      },
    });
    await r.view('teach.open');
    await r.send('teach.deepen');
    const done = await r.pollDone();
    expect(done['ok'], JSON.stringify(done)).toBe(true);
    const created = cardFiles(r.v).filter((id) => !BASE.includes(id));
    expect(created.map((id) => titleOfCard(r.v, id)).sort()).toEqual(['新卡1', '新卡3']);
    expect(logEvents(r.v, 'deepened')[0]).toMatchObject({ children: created, skipped: 1 });
    expect(questionFiles(r.v).filter((id) => !['sec-0001', 'sec-0002', 'sec-0003'].includes(id)).sort(), '只有留下的卡有考題檔').toEqual(created);
  });
});

describe('型別自測:畫面欄位的形狀', () => {
  it('DeepView 的 from 只有 id 與 title 兩個鍵(不外洩路徑、level)', async () => {
    const r = await deepRig({ children: 2 });
    await r.view('teach.open');
    const view: DeepView = await r.view('teach.deepen');
    expect(Object.keys(view.from ?? {}).sort()).toEqual(['id', 'title']);
    expect(Object.keys(view).sort()).toEqual(['canBack', 'card', 'categories', 'category', 'from', 'generating', 'prereqs']);
  });
});
