/**
 * T43(07 phase-3):背景工作、取消、「舊工作不得碰新工作」、考試卡不被擋(ADR-079 D1、D2 與顧問補的一條)。
 * 測試 agent 寫;開發 worker 不改。世界、假 router 見 `t43-harness.ts`;router 的呼叫用 `hold` 攔住,
 * 所以「取消那一刻手上正有一個呼叫」是確定性的,不靠計時。
 *
 * 取消的意思(D2,工單第 4 節):不再發新的呼叫、不寫任何檔、畫面回到原本那張;**已經送出的那一個呼叫讓它跑完**
 * (不傳 abort signal、不丟掉它的回應之前就拆掉 promise),它的 llm_call 由 router 照常記帳(ADR-050)。
 * 真 router 的帳由 cucumber(側車子行程 + 假網路)量;這裡量「handler 沒有想中斷它」:opts 裡沒有 signal。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { seedDue } from './review-session-harness.js';
import {
  PARENT,
  candidates,
  cardFiles,
  cleanupRigs,
  deepRig,
  diskHashes,
  errorKind,
  logEvents,
  newIds,
  questionFiles,
  readDeps,
  resultOf,
  type Obj,
} from './t43-harness.js';

afterAll(cleanupRigs);

const BASE = ['sec-0001', 'sec-0002', 'sec-0003'];
const timeout = <T>(p: Promise<T>, ms = 2000): Promise<T | 'timeout'> => Promise.race([p, new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), ms))]);

describe('Scenario: Cancelling writes nothing', () => {
  it('子卡的呼叫還沒回就取消:teach.cancel 回原本那張(generating: false、沒有麵包屑);放行之後磁碟不變、沒有 deepened、不再發新呼叫', async () => {
    const r = await deepRig();
    await r.view('teach.open');
    const before = diskHashes(r.v);
    const gate = r.router.hold((c) => c.kind === 'children');
    await r.send('teach.deepen');
    await gate.reached;
    const cancelled = await r.send('teach.cancel');
    expect(cancelled['ok'], JSON.stringify(cancelled)).toBe(true);
    const view = resultOf(cancelled);
    expect(view.card?.id).toBe(PARENT);
    expect(view.generating).toBe(false);
    expect(view.canBack).toBe(false);
    expect(view.from).toBeNull();
    gate.release();
    await r.quiet();
    expect(diskHashes(r.v), '放行之後等工作結束:一個位元組都沒變').toEqual(before);
    expect(logEvents(r.v, 'deepened')).toEqual([]);
    expect(r.router.calls, '剛好那一個呼叫,之後沒有新呼叫(考題一個都沒出)').toHaveLength(1);
  });

  it('子卡回來了、考題的呼叫還在途中時取消:不再出下一張的考題、不寫任何卡檔、考題檔、圖', async () => {
    const r = await deepRig({ setup: (router) => { router.children = () => candidates(3); } });
    await r.view('teach.open');
    const before = diskHashes(r.v);
    const gate = r.router.hold((c) => c.kind === 'questions');
    await r.send('teach.deepen');
    await gate.reached;
    const cancelled = await r.send('teach.cancel');
    expect(resultOf(cancelled).card?.id).toBe(PARENT);
    gate.release();
    await r.quiet();
    expect(r.router.of('questions'), '第一張的考題那一個呼叫跑完,第二、三張不再發').toHaveLength(1);
    expect(diskHashes(r.v)).toEqual(before);
    expect(cardFiles(r.v)).toEqual(BASE);
    expect(questionFiles(r.v)).not.toContain('sec-0004');
    expect(logEvents(r.v, 'deepened')).toEqual([]);
    expect(logEvents(r.v, 'learned')).toEqual([]);
  });

  it('字數重寫的呼叫在途中取消:不再重寫、不再出考題、不寫檔', async () => {
    const long = Array.from({ length: 101 }, (_, i) => `w${i}`).join(' ');
    const r = await deepRig({ setup: (router) => { router.children = () => [{ title: '新卡1', body: long, examples: [] }]; } });
    await r.view('teach.open');
    const before = diskHashes(r.v);
    const gate = r.router.hold((c) => c.kind === 'regenerate');
    await r.send('teach.deepen');
    await gate.reached;
    await r.send('teach.cancel');
    gate.release();
    await r.quiet();
    expect(r.router.calls.map((c) => c.kind)).toEqual(['children', 'regenerate']);
    expect(diskHashes(r.v)).toEqual(before);
  });

  it('取消不中斷已經送出的呼叫:呼叫的 opts 沒有 signal,它在取消之後照常回應(帳只能多不能少,ADR-050)', async () => {
    const r = await deepRig();
    await r.view('teach.open');
    const gate = r.router.hold((c) => c.kind === 'children');
    await r.send('teach.deepen');
    const reached = await gate.reached;
    expect(reached.opts === undefined || !('signal' in reached.opts), '不傳 AbortSignal 給 router').toBe(true);
    await r.send('teach.cancel');
    expect(r.router.inflight, '取消的當下,那一個呼叫還在跑(沒有被拆掉)').toBe(1);
    gate.release();
    await r.quiet();
    expect(r.router.inflight).toBe(0);
  });

  it('取消之後 teach.poll 不會又出現舊工作的結果或錯誤(回目前畫面)', async () => {
    const r = await deepRig();
    await r.view('teach.open');
    const gate = r.router.hold((c) => c.kind === 'children');
    await r.send('teach.deepen');
    await gate.reached;
    await r.send('teach.cancel');
    gate.release();
    await r.quiet();
    const res = await r.send('teach.poll');
    expect(res['ok']).toBe(true);
    expect(resultOf(res)).toMatchObject({ generating: false, canBack: false, from: null, card: { id: PARENT } });
  });

  it('取消之後舊工作的呼叫「丟錯」回來:不當成新錯誤報、不讓側車結束', async () => {
    const r = await deepRig();
    await r.view('teach.open');
    const gate = r.router.hold((c) => c.kind === 'children');
    await r.send('teach.deepen');
    await gate.reached;
    await r.send('teach.cancel');
    gate.fail(new Error('取消之後才失敗'));
    await r.quiet();
    const res = await r.send('teach.poll');
    expect(res['ok'], JSON.stringify(res)).toBe(true);
    expect((await r.view('teach.next')).card?.id).toBe('sec-0003');
  });

  it('工作已經寫完才收到取消:不刪檔,回寫完之後的畫面(第一張新卡,有麵包屑)', async () => {
    const r = await deepRig();
    await r.view('teach.open');
    await r.send('teach.deepen');
    await r.quiet();
    const afterWrite = diskHashes(r.v);
    expect(cardFiles(r.v)).toEqual([...BASE, ...newIds(2)]);
    const res = await r.send('teach.cancel');
    expect(res['ok']).toBe(true);
    const view = resultOf(res);
    expect(view.card?.id).toBe('sec-0004');
    expect(view.canBack).toBe(true);
    expect(view.generating).toBe(false);
    expect(diskHashes(r.v), '取消不能把剛寫好的卡拿掉').toEqual(afterWrite);
  });
});

describe('同一時間最多一個沒被取消的工作', () => {
  it('生成中再按深入:不開第二個工作(子卡的呼叫只有一個);回 bad-request 或原本的 generating 畫面都行', async () => {
    const r = await deepRig();
    await r.view('teach.open');
    const gate = r.router.hold((c) => c.kind === 'children');
    await r.send('teach.deepen');
    await gate.reached;
    const second = await r.send('teach.deepen');
    if (second['ok'] === true) expect(resultOf(second).generating).toBe(true);
    else expect(errorKind(second)).toBe('bad-request');
    gate.release();
    await r.pollDone();
    expect(r.router.of('children')).toHaveLength(1);
    expect(cardFiles(r.v)).toEqual([...BASE, ...newIds(2)]);
  });
});

describe('生成中不合狀態的請求:bad-request,不讀不寫、不改工作', () => {
  it.each([
    ['teach.next', {}],
    ['teach.switch', { category: 'network' }],
    ['teach.prereq', { index: 0 }],
    ['teach.back', {}],
  ] as [string, Obj][])('生成中送 %s → bad-request;工作照樣跑完,結果不受影響', async (method, params) => {
    const r = await deepRig();
    await r.view('teach.open');
    const gate = r.router.hold((c) => c.kind === 'children');
    await r.send('teach.deepen');
    await gate.reached;
    const before = diskHashes(r.v);
    const res = await r.send(method, params);
    expect(res['ok'], method).toBe(false);
    expect(errorKind(res)).toBe('bad-request');
    expect(diskHashes(r.v), '被拒絕的請求不寫任何東西').toEqual(before);
    gate.release();
    const done = await r.pollDone();
    expect(done['ok']).toBe(true);
    expect(resultOf(done).card?.id).toBe('sec-0004');
  });

  it('生成中送 teach.open(視窗重新載入):當成取消,再照舊開;舊工作什麼都不寫', async () => {
    const r = await deepRig();
    await r.view('teach.open');
    const before = diskHashes(r.v);
    const gate = r.router.hold((c) => c.kind === 'children');
    await r.send('teach.deepen');
    await gate.reached;
    const reopened = await r.send('teach.open');
    expect(reopened['ok'], JSON.stringify(reopened)).toBe(true);
    expect(resultOf(reopened)).toMatchObject({ generating: false, canBack: false, from: null, card: { id: PARENT } });
    gate.release();
    await r.quiet();
    expect(diskHashes(r.v)).toEqual(before);
    expect(r.router.calls).toHaveLength(1);
  });
});

describe('顧問補的一條:取消後馬上再按深入,舊工作手上那一個呼叫回來,不得寫檔、不得改到新工作', () => {
  it('新工作還在跑時舊呼叫回來:舊工作不再發呼叫、不寫檔、不改麵包屑與目前那張;新工作的 poll 照舊是 generating', async () => {
    const r = await deepRig({ setup: (router) => { router.children = () => candidates(2); } });
    await r.view('teach.open');
    const before = diskHashes(r.v);
    const oldGate = r.router.hold((c) => c.kind === 'children');
    await r.send('teach.deepen');
    await oldGate.reached;
    await r.send('teach.cancel');
    // 新工作:它的子卡呼叫會到達,考題呼叫被攔住(新工作停在中途)
    const newQuestions = r.router.hold((c) => c.kind === 'questions');
    const restarted = await r.send('teach.deepen');
    expect(restarted['ok'], JSON.stringify(restarted)).toBe(true);
    expect(resultOf(restarted).generating, '新工作開始了').toBe(true);
    await newQuestions.reached;
    const callsBeforeOldReturns = r.router.calls.length;
    // 舊工作手上那一個呼叫此時回來
    oldGate.release();
    await r.quiet(80);
    expect(r.router.calls.length, '舊工作回來之後沒有再發任何呼叫').toBe(callsBeforeOldReturns);
    expect(diskHashes(r.v), '舊工作沒寫任何東西').toEqual(before);
    const polled = await r.send('teach.poll');
    expect(polled['ok']).toBe(true);
    expect(resultOf(polled)).toMatchObject({ generating: true, card: { id: PARENT }, canBack: false });
    // 新工作放行:結果是新工作的,只有它寫的檔
    newQuestions.release();
    const done = await r.pollDone();
    expect(done['ok'], JSON.stringify(done)).toBe(true);
    expect(resultOf(done).card?.id).toBe('sec-0004');
    expect(cardFiles(r.v)).toEqual([...BASE, ...newIds(2)]);
    expect(logEvents(r.v, 'deepened'), '只記一次 deepened(新工作的)').toHaveLength(1);
    expect(r.router.of('children'), '子卡呼叫:舊的一次、新的一次').toHaveLength(2);
  });

  it('新工作已經寫完才輪到舊呼叫回來:磁碟不再變、麵包屑與目前那張不變、新工作的結果沒被蓋掉', async () => {
    const r = await deepRig({ setup: (router) => { router.children = () => candidates(2); } });
    await r.view('teach.open');
    const oldGate = r.router.hold((c) => c.kind === 'children');
    await r.send('teach.deepen');
    await oldGate.reached;
    await r.send('teach.cancel');
    await r.send('teach.deepen');
    const done = await r.pollDone();
    expect(resultOf(done).card?.id).toBe('sec-0004');
    const afterNew = diskHashes(r.v);
    const callsAfterNew = r.router.calls.length;
    // 舊呼叫在新工作寫完之後才回來
    oldGate.release();
    await r.quiet(80);
    expect(diskHashes(r.v), '舊工作不得再寫任何東西').toEqual(afterNew);
    expect(r.router.calls.length, '舊工作不得再發呼叫').toBe(callsAfterNew);
    const now = await r.view('teach.poll');
    expect(now).toMatchObject({ generating: false, canBack: true, card: { id: 'sec-0004' }, from: { id: PARENT } });
    // 麵包屑還是只有一層:back 回父卡,再 back 就是 bad-request
    expect((await r.view('teach.back')).card?.id).toBe(PARENT);
    expect(errorKind(await r.send('teach.back'))).toBe('bad-request');
    expect(logEvents(r.v, 'deepened')).toHaveLength(1);
  });

  it('舊呼叫晚回來而且是「丟錯」:新工作的 poll 狀態與結果都不受影響,側車不結束', async () => {
    const r = await deepRig();
    await r.view('teach.open');
    const oldGate = r.router.hold((c) => c.kind === 'children');
    await r.send('teach.deepen');
    await oldGate.reached;
    await r.send('teach.cancel');
    const newGate = r.router.hold((c) => c.kind === 'questions');
    await r.send('teach.deepen');
    await newGate.reached;
    oldGate.fail(new Error('舊工作的呼叫失敗'));
    await r.quiet(80);
    const mid = await r.send('teach.poll');
    expect(mid['ok'], '舊工作的錯不能變成新工作的 poll 錯誤').toBe(true);
    expect(resultOf(mid).generating).toBe(true);
    newGate.release();
    const done = await r.pollDone();
    expect(done['ok'], JSON.stringify(done)).toBe(true);
    expect(resultOf(done).card?.id).toBe('sec-0004');
  });

  it('舊呼叫晚回來而且是 NoModelError / 回應不合格式:一樣不碰新工作', async () => {
    const r = await deepRig({ setup: (router) => { router.children = '舊工作的回應不是 JSON'; } });
    await r.view('teach.open');
    const oldGate = r.router.hold((c) => c.kind === 'children');
    await r.send('teach.deepen');
    await oldGate.reached;
    await r.send('teach.cancel');
    router_switch(r.router);
    const newGate = r.router.hold((c) => c.kind === 'questions');
    await r.send('teach.deepen');
    await newGate.reached;
    oldGate.release(); // 舊工作的回應是壞的 JSON → 舊工作自己收尾,不能把 deepen-failed 寫到新工作頭上
    await r.quiet(80);
    expect(resultOf(await r.send('teach.poll')).generating).toBe(true);
    newGate.release();
    const done = await r.pollDone();
    expect(done['ok'], JSON.stringify(done)).toBe(true);
  });

  it('取消、再按深入、再取消:連續三個工作,舊的全都不寫;最後一個也被取消 → 磁碟與一開始一樣', async () => {
    const r = await deepRig();
    await r.view('teach.open');
    const before = diskHashes(r.v);
    const gates = [] as ReturnType<typeof r.router.hold>[];
    for (let i = 0; i < 3; i += 1) {
      const gate = r.router.hold((c) => c.kind === 'children');
      gates.push(gate);
      await r.send('teach.deepen');
      await gate.reached;
      await r.send('teach.cancel');
    }
    for (const g of gates) g.release();
    await r.quiet(100);
    expect(diskHashes(r.v)).toEqual(before);
    expect(r.router.calls).toHaveLength(3);
    expect(resultOf(await r.send('teach.poll'))).toMatchObject({ generating: false, card: { id: PARENT } });
  });
});

describe('考試卡不被生成擋住(D1:Rust 一次只收一個請求,所以 deepen 一定要馬上回)', () => {
  it('生成中考試卡的 start 與 next 馬上拿到回應(不用等生成結束)', async () => {
    const r = await deepRig({ learned: ['sec-0001'] });
    seedDue(r.v, ['sec-0001'], [1]);
    await r.view('teach.open');
    const gate = r.router.hold((c) => c.kind === 'children');
    await r.send('teach.deepen');
    await gate.reached;
    const start = await timeout(r.send('start'));
    expect(start, 'start 不能等到生成結束').not.toBe('timeout');
    expect((start as Obj)['ok'], JSON.stringify(start)).toBe(true);
    const next = await timeout(r.send('next'));
    expect(next, 'next 不能等到生成結束').not.toBe('timeout');
    expect((next as Obj)['ok'], JSON.stringify(next)).toBe(true);
    expect(((next as Obj)['result'] as Obj)['kind']).toBe('question');
    gate.release();
    await r.pollDone();
  });

  it('生成中 teach.poll 與 teach.cancel 也馬上回(兩邊的請求都不互相等)', async () => {
    const r = await deepRig();
    await r.view('teach.open');
    const gate = r.router.hold((c) => c.kind === 'children');
    await r.send('teach.deepen');
    await gate.reached;
    expect(await timeout(r.send('teach.poll'))).not.toBe('timeout');
    expect(await timeout(r.send('status'))).not.toBe('timeout');
    gate.release();
    await r.pollDone();
  });
});

describe('寫入是同步的一段:沒有寫一半的狀態', () => {
  it('poll 看到 generating: false 且成功的那一刻,卡檔、考題檔、圖、deepened 都已經在磁碟上', async () => {
    const r = await deepRig({ setup: (router) => { router.children = () => candidates(3); } });
    await r.view('teach.open');
    await r.send('teach.deepen');
    const done = await r.pollDone();
    expect(done['ok']).toBe(true);
    const ids = newIds(3);
    expect(cardFiles(r.v)).toEqual([...BASE, ...ids]);
    expect(questionFiles(r.v)).toEqual(expect.arrayContaining(ids));
    expect(readDeps(r.v)['security']!.nodes).toEqual(expect.arrayContaining(ids));
    expect(logEvents(r.v, 'deepened')).toHaveLength(1);
    const text = readFileSync(join(r.v.dir, 'state/log.jsonl'), 'utf8');
    expect(text.endsWith('\n'), 'log 每行都寫完整').toBe(true);
  });
});

/** 第二個工作要用的腳本:子卡正常、考題正常 */
function router_switch(router: { children: unknown }): void {
  router.children = () => candidates(2);
}
