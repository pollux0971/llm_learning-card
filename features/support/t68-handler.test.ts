/**
 * T68(07 phase-6 問 AI):側車 handler(`createReviewHandler`)的 `teach.ask` / `teach.ask.poll`(ADR-086,工單 T68)。
 * 測試 agent 寫;開發 worker 不改。看磁碟與送給模型的提示,不看畫面。世界、假 router、回應形狀見 `t68-harness.ts` 檔頭。
 *
 * 路由器是程序內的假物件(`FakeAskRouter`):每個 `teach.ask` 呼叫記 task、prompt、opts;可以在「回去」之前被攔住,所以
 * 「背景」「丟掉晚到的回答」「互斥」都不靠計時。不打網路、不花錢。真 router 的帳(llm_call)、離線走閘道、token 上限由
 * `t68-sidecar.test.ts`(真的子行程 + 假網路)量。
 *
 * 讀法:提示裡的「這張卡」靠卡的標題與 body(`<標題>的內文。`)認;「這一輪的問題」「前幾輪的問答」靠每一輪獨一無二的記號
 * (`QTOKEN-n` 是問題、`ATOKEN-n` 是回答)認——量的是「有沒有出現」,不假設提示的格式。
 *
 * 一個陷阱(輪數):工單表格寫「第 5 輪的提示不含第 1 輪」、must_catch 寫「第 N+1 輪的提示還含最舊的一輪」,N = 4。
 * 這裡取同一個意思:**一個提示最多帶 4 輪(含這一輪)**——第 5 個問題的提示帶第 2、3、4 輪的問答加第 5 輪的問題,不帶第 1 輪。
 *
 * 本來就綠(基底上已成立,守不退步):沒有(整個動作組都還沒有)。
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { NoModelError } from '../../packages/core/src/llm/errors.js';
import { cleanupRigs } from './t43-harness.js';
import { treeBytes } from './review-session-harness.js';
import {
  AFTER_PARENT,
  AFTER_PARENT_TITLE,
  PARENT,
  PARENT_TITLE,
  BAD_ANSWERS,
  askAnswer,
  askOf,
  askRig,
  bodyOf,
  cardIdOf,
  isAsking,
  kindOf,
  seedBadLedgerLine,
  seedSpend,
  setPrereqs,
  withTimeout,
  type AskRig,
  type Obj,
} from './t68-harness.js';

// 每條都真的起檔案,負載下會慢:逐檔放寬逾時(不動全域設定)
vi.setConfig({ testTimeout: 30_000 });

afterAll(cleanupRigs);

const Q = (n: number): string => `QTOKEN-${n}`;
const A = (n: number): string => `ATOKEN-${n}`;
/** 每一輪的回答都帶自己的記號 */
const answerTokens = (r: AskRig): void => {
  r.askRouter.reply = (call) => askAnswer({ answer: A(call.n), followups: [`FTOKEN-${call.n}`] });
};
const promptOf = (r: AskRig, n: number): string => r.askRouter.asks[n - 1]?.prompt ?? '';

describe('背景執行:teach.ask 馬上回 { asking: true },不等回答(must_catch 背景)', () => {
  it('回應在 router 回答之前就回來;poll 進行中也是 asking;放行後 poll 拿到 ask;router 只被叫一次、task 是 teach.ask', async () => {
    const r = await askRig();
    await r.view('teach.open');
    const gate = r.askRouter.hold();
    const first = await withTimeout(r.ask(Q(1)), 4000, 'teach.ask 不能等到回答才回(同步 await 雲端)');
    expect(first['ok'], JSON.stringify(first)).toBe(true);
    expect((first['result'] as Obj)['asking']).toBe(true);
    expect(askOf(first), '還沒有回答,不能先帶 ask').toBeUndefined();
    const reached = await gate.reached;
    expect(reached.prompt).toContain(Q(1));
    const mid = await r.send('teach.ask.poll');
    expect(isAsking(mid), `進行中 poll 要回 asking:${JSON.stringify(mid)}`).toBe(true);
    expect(askOf(mid)).toBeUndefined();
    gate.release();
    const done = await r.askDone();
    expect(done['ok'], JSON.stringify(done)).toBe(true);
    expect(askOf(done)).toMatchObject({ answer: '因為清單已經排好了。', provisional: false, suggestion: 'continue', highlight: 'next', followups: [] });
    expect(r.askRouter.asks).toHaveLength(1);
    expect(r.askRouter.tasks).toEqual(['teach.ask']);
  });

  it('等的時候別的請求不被擋:poll 之外,teach.load 這種唯讀動作也照常回', async () => {
    const r = await askRig();
    await r.view('teach.open');
    const gate = r.askRouter.hold();
    await r.ask(Q(1));
    await gate.reached;
    const load = await withTimeout(r.send('teach.load'), 3000, 'ask 跑著時 teach.load 要照常回');
    expect(load['ok'], JSON.stringify(load)).toBe(true);
    gate.release();
    await r.askDone();
  });
});

describe('互斥:一次一個 ask;deepen 跑著時不能問(must_catch 互斥)', () => {
  it('ask 跑著時再來一個 teach.ask 回 bad-request,而且不多打一個模型', async () => {
    const r = await askRig();
    await r.view('teach.open');
    const gate = r.askRouter.hold();
    await r.ask(Q(1));
    await gate.reached;
    const second = await r.ask(Q(2));
    expect(second['ok']).toBe(false);
    expect(kindOf(second)).toBe('bad-request');
    gate.release();
    const done = await r.askDone();
    expect(askOf(done)?.answer).toBeDefined();
    await r.settle();
    expect(r.askRouter.asks, '第二個問題沒有送出去').toHaveLength(1);
    expect(promptOf(r, 1)).not.toContain(Q(2));
  });

  it('deepen 跑著時 teach.ask 回 bad-request(跟 teach.next 的規則一樣),router 沒收到 ask', async () => {
    const r = await askRig();
    await r.view('teach.open');
    const gate = r.router.hold((c) => c.kind === 'children');
    const started = await r.send('teach.deepen');
    expect(started['ok'], JSON.stringify(started)).toBe(true);
    await gate.reached;
    const asked = await r.ask(Q(1));
    expect(asked['ok']).toBe(false);
    expect(kindOf(asked)).toBe('bad-request');
    expect(r.askRouter.asks).toHaveLength(0);
    gate.release();
    await r.pollDone();
    await r.settle();
    expect(r.askRouter.asks).toHaveLength(0);
  });

  it('ask 結束(答完或失敗)之後可以再問,不會卡在 busy', async () => {
    const r = await askRig();
    await r.view('teach.open');
    r.askRouter.reply = new Error('boom');
    const failed = await r.askFull(Q(1));
    expect(failed.ask?.error).toBe('failed');
    r.askRouter.reply = askAnswer();
    const again = await r.askFull(Q(2));
    expect(again.ask?.answer).toBeDefined();
    const third = await r.askFull(Q(3));
    expect(third.ask?.answer).toBeDefined();
  });
});

// 換卡的六個動作(ADR-086:換卡就清、照常執行、同時丟掉還在跑的 ask)。
interface Move {
  name: string;
  vault?: { children?: number; chain?: boolean };
  /** 在第一個問題之前做的事(把世界擺好) */
  prepare?: (r: AskRig) => Promise<void>;
  /** 動作本身;回整個回應 */
  act: (r: AskRig) => Promise<Obj>;
  /** 動作之後畫面上的卡 */
  expectCard: string;
  prereqs?: string[];
}
const MOVES: Move[] = [
  { name: 'teach.next', act: (r) => r.send('teach.next'), expectCard: AFTER_PARENT },
  { name: 'teach.switch', act: (r) => r.send('teach.switch', { category: 'network' }), expectCard: 'net-0001' },
  { name: 'teach.open', act: (r) => r.send('teach.open'), expectCard: PARENT },
  { name: 'teach.prereq', prereqs: [AFTER_PARENT], act: (r) => r.send('teach.prereq', { index: 0 }), expectCard: AFTER_PARENT },
  { name: 'teach.deepen(已有子卡:換到子卡)', vault: { children: 2 }, act: (r) => r.send('teach.deepen'), expectCard: 'sec-0004' },
  {
    name: 'teach.back(從子卡回父卡)',
    vault: { children: 2 },
    prepare: async (r) => {
      await r.view('teach.deepen');
    },
    act: (r) => r.send('teach.back'),
    expectCard: PARENT,
  },
];

async function rigFor(move: Move): Promise<AskRig> {
  const r = await askRig(move.vault ?? {});
  if (move.prereqs !== undefined) setPrereqs(r.v, PARENT, move.prereqs);
  await r.view('teach.open');
  await move.prepare?.(r);
  return r;
}

describe('問的時候換卡:動作照常執行、同時丟掉還在跑的 ask;晚到的回答不進新卡(must_catch 換卡後晚到)', () => {
  it.each(MOVES)('$name', async (move) => {
    const r = await rigFor(move);
    const gate = r.askRouter.hold();
    await r.ask(Q(1));
    await gate.reached;
    const res = await move.act(r);
    expect(res['ok'], `${move.name} 要照常執行(不是 busy / bad-request):${JSON.stringify(res)}`).toBe(true);
    expect(cardIdOf(res)).toBe(move.expectCard);
    // 回答這時才到
    r.askRouter.reply = askAnswer({ answer: A(1) });
    gate.release();
    await r.settle();
    const poll = await r.send('teach.ask.poll');
    expect(JSON.stringify(poll), '晚到的回答不能從 poll 出來').not.toContain(A(1));
    expect(askOf(poll)?.answer).toBeUndefined();
    // 新卡上再問:提示不含舊的問題與回答
    answerTokens(r);
    const again = await r.askFull(Q(2));
    expect(again.ask?.answer, JSON.stringify(again.done)).toBe(A(2));
    expect(promptOf(r, 2)).toContain(Q(2));
    expect(promptOf(r, 2), '新卡的提示不含舊的問題').not.toContain(Q(1));
    expect(promptOf(r, 2), '新卡的提示不含舊的回答').not.toContain(A(1));
  });

  it('回答已經到了、還沒被 poll 走,這時換卡:poll 不回舊卡的回答(換卡就清)', async () => {
    const r = await askRig();
    await r.view('teach.open');
    r.askRouter.reply = askAnswer({ answer: A(1) });
    const first = await r.ask(Q(1));
    expect(first['ok']).toBe(true);
    await r.settle();
    const moved = await r.send('teach.next');
    expect(moved['ok']).toBe(true);
    const poll = await r.send('teach.ask.poll');
    expect(JSON.stringify(poll)).not.toContain(A(1));
  });

  it('丟掉的 ask 不改任何東西:換卡之後晚到的回答不寫檔、不多記 learned', async () => {
    const r = await askRig();
    await r.view('teach.open');
    const gate = r.askRouter.hold();
    await r.ask(Q(1));
    await gate.reached;
    await r.send('teach.next');
    const before = treeBytes(r.v.scratch);
    gate.release();
    await r.settle();
    expect(treeBytes(r.v.scratch)).toEqual(before);
  });
});

describe('只問目前那張卡(must_catch 問的是別張卡)', () => {
  it('提示裡有目前這張卡的標題與內文、有這一輪的問題;沒有別張卡', async () => {
    const r = await askRig();
    await r.view('teach.open');
    const res = await r.askFull(Q(1));
    expect(res.ask?.answer).toBeDefined();
    const prompt = promptOf(r, 1);
    expect(prompt).toContain(PARENT_TITLE);
    expect(prompt).toContain(bodyOf(PARENT_TITLE));
    expect(prompt).toContain(Q(1));
    for (const other of [AFTER_PARENT_TITLE, bodyOf(AFTER_PARENT_TITLE), '封包', '路由']) expect(prompt, `不該有別張卡:${other}`).not.toContain(other);
  });

  it('提示有這張卡還沒學的先備(標題);沒有先備的卡就沒有', async () => {
    const r = await askRig();
    setPrereqs(r.v, PARENT, ['sec-0001', AFTER_PARENT]);
    await r.view('teach.open');
    await r.askFull(Q(1));
    expect(promptOf(r, 1), '還沒學的先備要在提示裡').toContain(AFTER_PARENT_TITLE);
  });

  it('換了卡再問:提示是新那張卡(標題、內文),不是上一張', async () => {
    const r = await askRig();
    await r.view('teach.open');
    answerTokens(r);
    await r.askFull(Q(1));
    const moved = await r.send('teach.next');
    expect(cardIdOf(moved)).toBe(AFTER_PARENT);
    await r.askFull(Q(2));
    const prompt = promptOf(r, 2);
    expect(prompt).toContain(AFTER_PARENT_TITLE);
    expect(prompt).toContain(bodyOf(AFTER_PARENT_TITLE));
    expect(prompt, '上一張的標題不能留在提示裡').not.toContain(PARENT_TITLE);
    expect(prompt).not.toContain(Q(1));
    expect(prompt).not.toContain(A(1));
  });

  it('換類別再問:提示是那個類別的卡', async () => {
    const r = await askRig();
    await r.view('teach.open');
    const moved = await r.send('teach.switch', { category: 'network' });
    expect(cardIdOf(moved)).toBe('net-0001');
    await r.askFull(Q(1));
    expect(promptOf(r, 1)).toContain('封包');
    expect(promptOf(r, 1)).not.toContain(PARENT_TITLE);
  });

  it('沒有目前這張卡時(今天的卡都學完了)問,回 error、不打模型、不丟例外', async () => {
    const r = await askRig();
    await r.view('teach.open');
    await r.view('teach.next');
    const end = await r.send('teach.next');
    expect(cardIdOf(end), '兩張 level 1 都學完').toBeUndefined();
    const res = await r.askFull(Q(1));
    // 回 bad-request 或帶 error 的 ask 都行,不能是模型被叫、也不能是丟例外
    expect(r.askRouter.asks, '沒有卡就不問模型').toHaveLength(0);
    expect(res.done['ok'] === false || res.ask?.error !== undefined, JSON.stringify(res.done)).toBe(true);
  });
});

describe('同一張卡的前幾輪問答一起給 AI;輪數上限 4(must_catch 輪數)', () => {
  it('第二輪的提示帶第一輪的問題與回答(追問選項也一樣:點了就是下一個問題的文字)', async () => {
    const r = await askRig();
    await r.view('teach.open');
    answerTokens(r);
    const first = await r.askFull(Q(1));
    expect(first.ask?.followups).toEqual(['FTOKEN-1']);
    // 點追問 = 把那段字當成下一個問題送出去
    const second = await r.askFull(first.ask!.followups![0]!);
    expect(second.ask?.answer).toBe(A(2));
    const prompt = promptOf(r, 2);
    expect(prompt).toContain('FTOKEN-1');
    expect(prompt, '前一輪的問題').toContain(Q(1));
    expect(prompt, '前一輪的回答').toContain(A(1));
  });

  it('提示最多帶 4 輪(含這一輪):第 4 個問題還帶第 1 輪;第 5 個問題不帶第 1 輪,仍帶第 2、3、4 輪', async () => {
    const r = await askRig();
    await r.view('teach.open');
    answerTokens(r);
    for (let n = 1; n <= 6; n += 1) {
      const res = await r.askFull(Q(n));
      expect(res.ask?.answer, `第 ${n} 輪:${JSON.stringify(res.done)}`).toBe(A(n));
    }
    expect(promptOf(r, 3)).toContain(Q(1));
    const p4 = promptOf(r, 4);
    for (const n of [1, 2, 3]) {
      expect(p4, `第 4 輪帶第 ${n} 輪的問題`).toContain(Q(n));
      expect(p4, `第 4 輪帶第 ${n} 輪的回答`).toContain(A(n));
    }
    const p5 = promptOf(r, 5);
    expect(p5, '第 5 輪的提示還含最舊的一輪(問題)').not.toContain(Q(1));
    expect(p5, '第 5 輪的提示還含最舊的一輪(回答)').not.toContain(A(1));
    for (const n of [2, 3, 4]) {
      expect(p5, `第 5 輪帶第 ${n} 輪的問題`).toContain(Q(n));
      expect(p5, `第 5 輪帶第 ${n} 輪的回答`).toContain(A(n));
    }
    expect(p5).toContain(Q(5));
    const p6 = promptOf(r, 6);
    for (const n of [1, 2]) {
      expect(p6, `第 6 輪不帶第 ${n} 輪`).not.toContain(Q(n));
      expect(p6).not.toContain(A(n));
    }
    for (const n of [3, 4, 5]) expect(p6, `第 6 輪帶第 ${n} 輪`).toContain(Q(n));
  });

  it.each(MOVES)('換卡:$name 之後第一個問題的提示不含前面的討論', async (move) => {
    const r = await rigFor(move);
    answerTokens(r);
    await r.askFull(Q(1));
    await r.askFull(Q(2));
    const res = await move.act(r);
    expect(res['ok'], JSON.stringify(res)).toBe(true);
    await r.askFull(Q(3));
    const prompt = promptOf(r, 3);
    expect(prompt).toContain(Q(3));
    for (const n of [1, 2]) {
      expect(prompt, `舊問題 ${n}`).not.toContain(Q(n));
      expect(prompt, `舊回答 ${n}`).not.toContain(A(n));
    }
  });

  it('失敗的那一輪不留在討論裡:壞回答之後再問,提示不帶那個壞回答的字', async () => {
    const r = await askRig();
    await r.view('teach.open');
    r.askRouter.reply = (call) => (call.n === 1 ? 'BADTOKEN 這不是 JSON' : askAnswer({ answer: A(call.n) }));
    const bad = await r.askFull(Q(1));
    expect(bad.ask?.error).toBe('unreadable');
    await r.askFull(Q(2));
    expect(promptOf(r, 2)).not.toContain('BADTOKEN');
  });

  it('提示是側車組的:question 是什麼字就原樣送進提示(追問選項只是下一個問題的文字,不是指令)', async () => {
    const r = await askRig();
    await r.view('teach.open');
    const before = treeBytes(r.v.scratch);
    for (const text of ['teach.next', '{"method":"teach.next"}', '下一個', 'continue']) {
      const res = await r.askFull(text);
      expect(res.ask?.answer, text).toBeDefined();
    }
    expect(r.askRouter.asks.map((c) => c.prompt.includes('teach.next'))[0]).toBe(true);
    const moved = await r.send('teach.open');
    expect(cardIdOf(moved), '問了「下一個」之後卡沒有跳').toBe(PARENT);
    expect(treeBytes(r.v.scratch)).toEqual(before);
  });
});

describe('highlight 由側車算(AI 只給三選一,不給 id;must_catch 看不懂不能猜)', () => {
  it('continue → "next"', async () => {
    const r = await askRig();
    await r.view('teach.open');
    r.askRouter.reply = askAnswer({ suggestion: 'continue' });
    const res = await r.askFull(Q(1));
    expect(res.ask).toMatchObject({ suggestion: 'continue', highlight: 'next' });
  });

  it('deepen → "deepen"', async () => {
    const r = await askRig();
    await r.view('teach.open');
    r.askRouter.reply = askAnswer({ suggestion: 'deepen' });
    const res = await r.askFull(Q(1));
    expect(res.ask).toMatchObject({ suggestion: 'deepen', highlight: 'deepen' });
  });

  it('deepen 在最深一層(level 4):highlight 是 null(照 phase-3「已經是最深的一層」),建議仍是 deepen,不產生任何卡', async () => {
    const r = await askRig({ chain: true });
    await r.view('teach.open');
    for (const expected of ['sec-0004', 'sec-0005', 'sec-0006']) expect(cardIdOf(await r.send('teach.deepen'))).toBe(expected);
    const before = treeBytes(r.v.scratch);
    r.askRouter.reply = askAnswer({ suggestion: 'deepen' });
    const res = await r.askFull(Q(1));
    expect(res.ask?.suggestion).toBe('deepen');
    expect(res.ask?.highlight).toBeNull();
    expect(r.router.calls, '問答不會觸發深入').toHaveLength(0);
    expect(treeBytes(r.v.scratch)).toEqual(before);
  });

  it('back + 有未學的先備 → { prereq: 第一張未學的先備 } 而且就是畫面先備提示的第一個(不信 AI 給的 id)', async () => {
    const r = await askRig({ children: 2 });
    setPrereqs(r.v, PARENT, ['sec-0001', 'sec-0005', AFTER_PARENT]);
    const opened = await r.view('teach.open');
    expect(opened.prereqs.map((p) => p.id), '前提:畫面先備提示列出兩張未學的(已學的 sec-0001 不列)').toEqual(['sec-0005', AFTER_PARENT]);
    r.askRouter.reply = askAnswer({ suggestion: 'back' });
    const res = await r.askFull(Q(1));
    expect(res.ask?.suggestion).toBe('back');
    expect(res.ask?.highlight).toEqual({ prereq: opened.prereqs[0]!.id });
  });

  it('back + 先備都學過 → highlight 是 null(不亮任何東西),建議仍是 back', async () => {
    const r = await askRig();
    await r.view('teach.open');
    r.askRouter.reply = askAnswer({ suggestion: 'back' });
    const res = await r.askFull(Q(1));
    expect(res.ask?.suggestion).toBe('back');
    expect(res.ask?.highlight).toBeNull();
    expect(res.ask?.error).toBeUndefined();
  });

  it('back:從父卡深入下來的子卡,先備提示不列父卡,所以亮的是父卡以外第一張未學的先備', async () => {
    const r = await askRig({ children: 2, childPrereqs: [AFTER_PARENT] });
    await r.view('teach.open');
    const child = await r.view('teach.deepen');
    expect(child.card?.id).toBe('sec-0004');
    expect(child.prereqs.map((p) => p.id), '前提:畫面先備提示只有 sec-0003(父卡 sec-0002 沒學過,但你剛從它下來)').toEqual([AFTER_PARENT]);
    r.askRouter.reply = askAnswer({ suggestion: 'back' });
    const res = await r.askFull(Q(1));
    expect(res.ask?.highlight).toEqual({ prereq: AFTER_PARENT });
  });

  it('AI 的 suggestion 只影響亮哪裡,不改任何東西:三種建議之後卡都沒動、reviews 與卡檔位元組不變、沒有 learned 事件', async () => {
    const r = await askRig({ children: 2 });
    setPrereqs(r.v, PARENT, ['sec-0001', AFTER_PARENT]);
    await r.view('teach.open');
    const before = treeBytes(r.v.scratch);
    for (const suggestion of ['continue', 'deepen', 'back']) {
      r.askRouter.reply = askAnswer({ suggestion });
      const res = await r.askFull(Q(1));
      expect(res.ask?.suggestion).toBe(suggestion);
    }
    expect(treeBytes(r.v.scratch)).toEqual(before);
    const still = await r.send('teach.open');
    expect(cardIdOf(still), '三次問答之後卡還是原來那張').toBe(PARENT);
  });
});

describe('提供給畫面的欄位:provisional、followups、answer 原樣', () => {
  it('在線:provisional 是 false;離線走本機:provisional 是 true(router 回的 provisional 帶回去)', async () => {
    const r = await askRig();
    await r.view('teach.open');
    const online = await r.askFull(Q(1));
    expect(online.ask?.provisional).toBe(false);
    r.askRouter.provisional = true;
    const offline = await r.askFull(Q(2));
    expect(offline.ask?.provisional).toBe(true);
    expect(offline.ask?.answer).toBeDefined();
  });

  it('answer 與 followups 原樣帶回(不截、不改);0 到 3 個追問都行;長度不檢查(只檢查非空)', async () => {
    const r = await askRig();
    await r.view('teach.open');
    const longAnswer = '長'.repeat(5000);
    const longFollowup = '問'.repeat(300);
    for (const followups of [[], ['一'], ['一', '二'], ['一', '二', longFollowup]]) {
      r.askRouter.reply = askAnswer({ answer: longAnswer, followups });
      const res = await r.askFull(Q(1));
      expect(res.ask?.answer).toBe(longAnswer);
      expect(res.ask?.followups).toEqual(followups);
    }
  });
});

describe('失敗四種:unreadable / no-model / budget / failed(must_catch 解析失敗、不猜)', () => {
  it.each(BAD_ANSWERS)('看不懂的回答(%s):error 是 unreadable、訊息說可以再問、不亮任何東西、不當成 continue、不丟例外', async (_name, text) => {
    const r = await askRig();
    await r.view('teach.open');
    r.askRouter.reply = text;
    const res = await r.askFull(Q(1));
    expect(res.done['ok'], JSON.stringify(res.done)).toBe(true);
    const ask = res.ask!;
    expect(ask, JSON.stringify(res.done)).toBeDefined();
    expect(ask.error).toBe('unreadable');
    expect(String(ask.message)).toMatch(/再問/);
    expect(ask.highlight ?? null, '看不懂就不亮').toBeNull();
    expect(ask.suggestion ?? 'none', '看不懂的建議是 none,不是 continue').toBe('none');
    expect(ask.answer, '看不懂的回答不能當成答案顯示').toBeUndefined();
    expect(ask.followups ?? [], '看不懂就不給追問').toEqual([]);
    // 後面還能用
    const moved = await r.send('teach.next');
    expect(moved['ok']).toBe(true);
  });

  it('離線又沒有本機模型(router 丟 NO_MODEL):error 是 no-model;卡照常能往下', async () => {
    const r = await askRig();
    await r.view('teach.open');
    r.askRouter.reply = new NoModelError('teach.ask');
    const res = await r.askFull(Q(1));
    expect(res.done['ok'], JSON.stringify(res.done)).toBe(true);
    expect(res.ask?.error).toBe('no-model');
    expect(String(res.ask?.message).length).toBeGreaterThan(0);
    expect(res.ask?.highlight ?? null).toBeNull();
    const moved = await r.send('teach.next');
    expect(moved['ok']).toBe(true);
    expect(cardIdOf(moved)).toBe(AFTER_PARENT);
  });

  it('router 丟別的錯(逾時、連線、任何例外):error 是 failed;訊息是固定句子,不帶例外原文', async () => {
    const r = await askRig();
    await r.view('teach.open');
    for (const err of [new Error('boom-secret-detail'), Object.assign(new Error('timeout-secret-detail'), { code: 'LLM_TIMEOUT' }), new TypeError('fetch failed secret-detail')]) {
      r.askRouter.reply = err;
      const res = await r.askFull(Q(1));
      expect(res.done['ok'], JSON.stringify(res.done)).toBe(true);
      expect(res.ask?.error).toBe('failed');
      expect(String(res.ask?.message)).not.toMatch(/secret-detail|boom|timeout-/);
      expect(res.ask?.highlight ?? null).toBeNull();
    }
  });

  it('失敗後 poll 不會重複回同一個錯誤之外的舊答案;下一次問是新的一輪', async () => {
    const r = await askRig();
    await r.view('teach.open');
    r.askRouter.reply = askAnswer({ answer: A(1) });
    const ok = await r.askFull(Q(1));
    expect(ok.ask?.answer).toBe(A(1));
    r.askRouter.reply = new Error('x');
    const failed = await r.askFull(Q(2));
    expect(failed.ask?.error).toBe('failed');
    expect(JSON.stringify(failed.done)).not.toContain(A(1));
  });
});

describe('花費:呼叫前照 LLM_DAILY_CAP_USD 擋(must_catch 上限、CAP=0)', () => {
  const ENV = { LLM_DAILY_CAP_USD: '1' };

  it('今天已經花到上限:error 是 budget、router 呼叫 0 次、帳本沒有多東西', async () => {
    const r = await askRig({ env: ENV });
    seedSpend(r.v, 1);
    await r.view('teach.open');
    const logBefore = treeBytes(r.v.scratch);
    const res = await r.askFull(Q(1));
    expect(res.done['ok'], JSON.stringify(res.done)).toBe(true);
    expect(res.ask?.error).toBe('budget');
    expect(String(res.ask?.message).length).toBeGreaterThan(0);
    expect(res.ask?.highlight ?? null).toBeNull();
    await r.settle();
    expect(r.askRouter.asks, '到上限還呼叫了 AI').toHaveLength(0);
    expect(r.askRouter.tasks).toEqual([]);
    expect(treeBytes(r.v.scratch)).toEqual(logBefore);
    const moved = await r.send('teach.next');
    expect(moved['ok'], '到上限之後卡照常能往下').toBe(true);
  });

  it('超過上限(花了 2 美元、上限 1)也擋;差一點點(花 0.99999 美元、上限 1)還能問', async () => {
    const over = await askRig({ env: ENV });
    seedSpend(over.v, 2);
    await over.view('teach.open');
    expect((await over.askFull(Q(1))).ask?.error).toBe('budget');
    expect(over.askRouter.asks).toHaveLength(0);

    const under = await askRig({ env: ENV });
    seedSpend(under.v, 0.99999);
    await under.view('teach.open');
    const res = await under.askFull(Q(1));
    expect(res.ask?.answer, JSON.stringify(res.done)).toBeDefined();
    expect(under.askRouter.asks).toHaveLength(1);
  });

  it('LLM_DAILY_CAP_USD=0 是「沒有上限」,不是「已用完」:花了很多錢照樣呼叫', async () => {
    const r = await askRig({ env: { LLM_DAILY_CAP_USD: '0' } });
    seedSpend(r.v, 50);
    await r.view('teach.open');
    const res = await r.askFull(Q(1));
    expect(res.ask?.error, JSON.stringify(res.done)).toBeUndefined();
    expect(res.ask?.answer).toBeDefined();
    expect(r.askRouter.asks).toHaveLength(1);
  });

  it('沒設上限:用預設 1 美元(契約 §11);花了 2 美元就擋', async () => {
    const r = await askRig({ env: { LLM_DAILY_CAP_USD: undefined } });
    seedSpend(r.v, 2);
    await r.view('teach.open');
    expect((await r.askFull(Q(1))).ask?.error).toBe('budget');
    expect(r.askRouter.asks).toHaveLength(0);
  });

  it('只算今天:昨天花了 5 美元,今天照常能問', async () => {
    const r = await askRig({ env: ENV });
    seedSpend(r.v, 5, '2026-09-09');
    await r.view('teach.open');
    const res = await r.askFull(Q(1));
    expect(res.ask?.answer, JSON.stringify(res.done)).toBeDefined();
    expect(r.askRouter.asks).toHaveLength(1);
  });

  it('帳本有壞行(今日花費是「不知道」,不是 0):不呼叫 AI,回的是 error,不丟例外', async () => {
    const r = await askRig({ env: ENV });
    seedBadLedgerLine(r.v);
    await r.view('teach.open');
    const res = await r.askFull(Q(1));
    expect(res.done['ok'] === false || res.ask?.error !== undefined, JSON.stringify(res.done)).toBe(true);
    expect(res.ask?.answer, '壞帳本不能當成 0 美元繼續花').toBeUndefined();
    await r.settle();
    expect(r.askRouter.asks, '花費不知道的時候不呼叫 AI').toHaveLength(0);
  });
});

describe('不落地:問答不寫任何檔(must_catch 不落地)', () => {
  it('問了、答了、追問了:整個暫存世界(卡、考題、deps、order、reviews、log、快取)一個位元組都沒變', async () => {
    const r = await askRig({ children: 2 });
    await r.view('teach.open');
    const before = treeBytes(r.v.scratch);
    answerTokens(r);
    const a = await r.askFull(Q(1));
    expect(a.ask?.answer).toBe(A(1));
    const b = await r.askFull(a.ask!.followups![0]!);
    expect(b.ask?.answer).toBe(A(2));
    expect(treeBytes(r.v.scratch)).toEqual(before);
  });

  it('失敗的問答(看不懂、沒有模型、上限、failed)也不寫任何檔', async () => {
    const r = await askRig({ env: { LLM_DAILY_CAP_USD: '1' } });
    await r.view('teach.open');
    const before = treeBytes(r.v.scratch);
    r.askRouter.reply = 'not json';
    expect((await r.askFull(Q(1))).ask?.error).toBe('unreadable');
    r.askRouter.reply = new NoModelError('teach.ask');
    expect((await r.askFull(Q(2))).ask?.error).toBe('no-model');
    r.askRouter.reply = new Error('x');
    expect((await r.askFull(Q(3))).ask?.error).toBe('failed');
    expect(treeBytes(r.v.scratch), '三種失敗都不寫任何檔').toEqual(before);
    seedSpend(r.v, 5);
    const budgetBefore = treeBytes(r.v.scratch);
    expect((await r.askFull(Q(4))).ask?.error).toBe('budget');
    expect(treeBytes(r.v.scratch)).toEqual(budgetBefore);
    expect(Object.keys(budgetBefore).sort(), '上限那一次也沒有多出任何檔').toEqual(Object.keys(before).sort());
  });

  it('問的時候 AI 建議深入:不會產生任何卡(沒有打 children / questions 的呼叫、cards 目錄沒變)', async () => {
    const r = await askRig();
    await r.view('teach.open');
    const before = treeBytes(r.v.scratch);
    r.askRouter.reply = askAnswer({ suggestion: 'deepen' });
    const res = await r.askFull(Q(1));
    expect(res.ask?.highlight).toBe('deepen');
    await r.settle();
    expect(r.router.calls, '深入的呼叫要等人按了才有').toHaveLength(0);
    expect(r.askRouter.tasks).toEqual(['teach.ask']);
    expect(treeBytes(r.v.scratch)).toEqual(before);
  });
});

describe('對既有行為的不退步(守住:基底上這幾條本來就成立)', () => {
  it('沒有人問的時候,teach.* 既有動作的回應不多任何欄位(不帶 ask、不帶 asking)', async () => {
    const r = await askRig();
    for (const [method, params] of [['teach.open', {}], ['teach.next', {}], ['teach.poll', {}], ['teach.load', {}]] as [string, Obj][]) {
      const res = await r.send(method, params);
      expect(res['ok'], method).toBe(true);
      const result = res['result'] as Obj;
      expect('ask' in result, `${method} 不帶 ask`).toBe(false);
      expect('asking' in result, `${method} 不帶 asking`).toBe(false);
    }
  });
});

// 量尺自測:BAD_ANSWERS 真的沒有一個是合法的回答(免得「看不懂」的測試對著一個其實合法的字串)
describe('量尺自測', () => {
  it('BAD_ANSWERS 每一個都不是 { answer 非空, suggestion 三選一, followups 0–3 個非空字串 } 的嚴格物件', () => {
    const valid = (text: string): boolean => {
      try {
        const v = JSON.parse(text) as Record<string, unknown>;
        if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
        if (Object.keys(v).sort().join() !== 'answer,followups,suggestion') return false;
        if (typeof v['answer'] !== 'string' || v['answer'] === '') return false;
        if (!['continue', 'deepen', 'back'].includes(v['suggestion'] as string)) return false;
        const f = v['followups'];
        return Array.isArray(f) && f.length <= 3 && f.every((x) => typeof x === 'string' && x !== '');
      } catch {
        return false;
      }
    };
    for (const [name, text] of BAD_ANSWERS) expect(valid(text), name).toBe(false);
    expect(valid(askAnswer())).toBe(true);
    expect(valid(askAnswer({ followups: ['a', 'b', 'c'] }))).toBe(true);
  });
});
