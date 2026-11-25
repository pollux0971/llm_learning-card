/**
 * T68 驗收補測(測試 agent 寫;開發 worker 不改):驗收者的 ask 變異 71.19% 揭出來的缺口 G1–G9(docs/reviews/acceptance-T68-impl.md)。
 * 這批是「實作已經做對、測試還沒釘」的缺口,所以在 t68-impl 上本來就綠;證明有效靠改壞版轉紅(commit 說明)。
 * 世界、假 router、回應形狀見 `t68-harness.ts` 檔頭。提示格式相關的斷言只釘「含哪些內容」,標籤字樣只在必要處(最深一層、前面的討論)。
 *   G1 提示含卡標題、body、example、還沒學的先備標題;G2 呼叫中 router 丟 BUDGET_EXCEEDED → error budget;G3 全新 learning 沒有 log.jsonl 第一次問成功;
 *   G4 空白問題 → bad-request、不呼叫;G5 deepen 失敗後問答還在、deepen 開始時丟掉在跑的 ask;G6 第一輪(與換卡後第一問)沒有「前面的討論」區塊;
 *   G7 answer / 追問全空白 → unreadable;G8 沒有 ask 時 poll 回純畫面;G9 每種 error 的 message 非空而且彼此不同。
 */
import { appendFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { DailyBudgetExceededError, NoModelError } from '../../packages/core/src/llm/errors.js';
import { cleanupRigs } from './t43-harness.js';
import { AFTER_PARENT, PARENT, PARENT_TITLE, askAnswer, askOf, askRig, bodyOf, cardIdOf, kindOf, seedBadLedgerLine, type AskRig, type Obj, type Vault } from './t68-harness.js';

vi.setConfig({ testTimeout: 30_000 });
afterAll(cleanupRigs);

const Q = (n: number): string => `QTOKEN-${n}`;
const A = (n: number): string => `ATOKEN-${n}`;
const promptOf = (r: AskRig, n: number): string => r.askRouter.asks[n - 1]?.prompt ?? '';
const EARLIER = /earlier (question|answer|discussion)/i;

/** 卡檔尾巴加一個 example 圍欄(契約 §2)。 */
function addExample(v: Vault, id: string, text: string): void {
  appendFileSync(join(v.dir, 'cards/security', `${id}.md`), `\n\`\`\`example\n${text}\n\`\`\`\n`, 'utf8');
}

describe('G1 提示含這張卡的標題、內文、example、還沒學的先備標題', () => {
  it('標題、內文、每個 example(照順序)、未學先備標題都在提示裡', async () => {
    const r = await askRig();
    addExample(r.v, PARENT, 'EXAMPLE-TOKEN-ONE');
    addExample(r.v, PARENT, 'EXAMPLE-TOKEN-TWO');
    await r.view('teach.open');
    const res = await r.askFull(Q(1));
    expect(res.ask?.answer).toBeDefined();
    const prompt = promptOf(r, 1);
    expect(prompt).toContain(PARENT_TITLE);
    expect(prompt).toContain(bodyOf(PARENT_TITLE));
    expect(prompt).toContain('EXAMPLE-TOKEN-ONE');
    expect(prompt).toContain('EXAMPLE-TOKEN-TWO');
    expect(prompt.indexOf('EXAMPLE-TOKEN-ONE')).toBeLessThan(prompt.indexOf('EXAMPLE-TOKEN-TWO'));
    expect(prompt.indexOf(bodyOf(PARENT_TITLE)), '內文在 example 前面').toBeLessThan(prompt.indexOf('EXAMPLE-TOKEN-ONE'));
    expect(prompt.indexOf(Q(1)), '這一輪的問題在最後').toBeGreaterThan(prompt.indexOf('EXAMPLE-TOKEN-TWO'));
  });

  it('分類與層級也送給模型(category、level 的值在提示裡)', async () => {
    const r = await askRig();
    await r.view('teach.open');
    await r.askFull(Q(1));
    const prompt = promptOf(r, 1);
    expect(prompt).toMatch(/security/);
    expect(prompt).toMatch(/level:?\s*1\b/);
  });

  it('最深一層(level 4)的卡,提示要告訴模型「已經是最深一層」;不是最深的卡,提示是相反的值', async () => {
    const deep = await askRig({ chain: true });
    await deep.view('teach.open');
    for (let i = 0; i < 3; i += 1) await deep.view('teach.deepen');
    await deep.askFull(Q(1));
    expect(promptOf(deep, 1)).toMatch(/^deepest level:\s*yes\s*$/im);

    const plain = await askRig();
    await plain.view('teach.open');
    await plain.askFull(Q(1));
    expect(promptOf(plain, 1)).toMatch(/^deepest level:\s*no\s*$/im);
    expect(promptOf(plain, 1)).not.toMatch(/^deepest level:\s*yes\s*$/im);
  });

  it('沒有未學先備時提示標明沒有;有的時候每一張未學先備的標題都在', async () => {
    const none = await askRig();
    await none.view('teach.open');
    await none.askFull(Q(1));
    expect(promptOf(none, 1)).toMatch(/unlearned prereqs:\s*\(none\)/i);
    expect(promptOf(none, 1)).not.toContain('跨來源請求');

    const some = await askRig({ children: 2 });
    const path = join(some.v.dir, 'cards/security', `${PARENT}.md`);
    writeFileSync(path, readFileSync(path, 'utf8').replace(/^prereqs: \[.*\]$/m, `prereqs: [sec-0001, ${AFTER_PARENT}, sec-0005]`), 'utf8');
    await some.view('teach.open');
    await some.askFull(Q(1));
    expect(promptOf(some, 1)).toContain('跨來源請求');
    expect(promptOf(some, 1)).toContain('子卡2');
    expect(promptOf(some, 1)).not.toMatch(/unlearned prereqs:\s*\(none\)/i);
  });
});

describe('G2 呼叫中 router 丟 BUDGET_EXCEEDED → error budget(不是 failed)', () => {
  it('router 說今日預算用完(DailyBudgetExceededError):ask.error 是 budget、訊息非空、不亮', async () => {
    const r = await askRig();
    await r.view('teach.open');
    r.askRouter.reply = new DailyBudgetExceededError('teach.ask', 1.5, 1);
    const res = await r.askFull(Q(1));
    expect(res.done['ok'], JSON.stringify(res.done)).toBe(true);
    expect(res.ask?.error).toBe('budget');
    expect(String(res.ask?.message).trim().length).toBeGreaterThan(0);
    expect(res.ask?.highlight ?? null).toBeNull();
    expect(r.askRouter.asks).toHaveLength(1);
  });
});

describe('G3 全新的 learning(沒有 state/log.jsonl)第一次問就成功', () => {
  it('log.jsonl 不存在 = 還沒花過錢(不是壞帳本):照常呼叫、回答、call 一次', async () => {
    const r = await askRig();
    rmSync(join(r.v.dir, 'state/log.jsonl'), { force: true });
    await r.view('teach.open');
    const res = await r.askFull(Q(1));
    expect(res.ask?.error, JSON.stringify(res.done)).toBeUndefined();
    expect(res.ask?.answer).toBeDefined();
    expect(r.askRouter.asks).toHaveLength(1);
  });

  it('log.jsonl 是空檔也一樣', async () => {
    const r = await askRig();
    writeFileSync(join(r.v.dir, 'state/log.jsonl'), '', 'utf8');
    await r.view('teach.open');
    const res = await r.askFull(Q(1));
    expect(res.ask?.answer).toBeDefined();
    expect(r.askRouter.asks).toHaveLength(1);
  });
});

describe('G4 空白問題 → bad-request,不呼叫 AI', () => {
  it.each([['空字串', ''], ['只有空白', '   '], ['只有換行與 tab', '\n\t \r\n']])('%s', async (_name, question) => {
    const r = await askRig();
    await r.view('teach.open');
    const res = await r.ask(question);
    expect(res['ok'], JSON.stringify(res)).toBe(false);
    expect(kindOf(res)).toBe('bad-request');
    await r.settle();
    expect(r.askRouter.asks).toHaveLength(0);
    // 被拒絕的空問題不佔著「一次一個」:接著正常問得動
    const next = await r.askFull(Q(1));
    expect(next.ask?.answer).toBeDefined();
  });

  it('前後有空白的正常問題照問(不是空的)', async () => {
    const r = await askRig();
    await r.view('teach.open');
    const res = await r.askFull(`  ${Q(1)}  `);
    expect(res.ask?.answer).toBeDefined();
    expect(promptOf(r, 1)).toContain(Q(1));
  });
});

describe('G5 deepen 與 ask 的交界', () => {
  it('deepen 失敗(沒生出卡)之後,前一輪問答還在:卡沒換,下一個問題的提示仍帶前一輪', async () => {
    const r = await askRig();
    await r.view('teach.open');
    r.askRouter.reply = askAnswer({ answer: A(1) });
    await r.askFull(Q(1));
    r.router.children = new Error('boom');
    await r.view('teach.deepen').catch(() => undefined);
    await r.pollDone();
    const still = await r.send('teach.poll');
    expect(cardIdOf(still), '卡沒換').toBe(PARENT);
    r.askRouter.reply = askAnswer({ answer: A(2) });
    await r.askFull(Q(2));
    expect(promptOf(r, 2)).toContain(Q(1));
    expect(promptOf(r, 2)).toContain(A(1));
  });

  it('ask 跑著時開始 deepen(要生成的那條路):deepen 照常開始、ask 被丟掉、晚到的回答不會出來', async () => {
    const r = await askRig();
    await r.view('teach.open');
    const gate = r.askRouter.hold();
    await r.ask(Q(1));
    await gate.reached;
    const hold = r.router.hold((c) => c.kind === 'children');
    const started = await r.send('teach.deepen');
    expect(started['ok'], JSON.stringify(started)).toBe(true);
    await hold.reached;
    r.askRouter.reply = askAnswer({ answer: A(1) });
    gate.release();
    await new Promise((resolve) => setTimeout(resolve, 150));
    hold.release();
    await r.pollDone();
    const poll = await r.send('teach.ask.poll');
    expect(JSON.stringify(poll)).not.toContain(A(1));
  });
});

describe('G6 第一輪(與換卡後第一問)的提示沒有「前面的討論」區塊', () => {
  it('第一個問題沒有;第二個問題有;換卡後的第一個問題又沒有;失敗那一輪之後的下一問也沒有', async () => {
    const r = await askRig();
    await r.view('teach.open');
    await r.askFull(Q(1));
    expect(promptOf(r, 1), '第一輪不該有前面的討論').not.toMatch(EARLIER);
    await r.askFull(Q(2));
    expect(promptOf(r, 2)).toMatch(EARLIER);
    await r.send('teach.next');
    await r.askFull(Q(3));
    expect(promptOf(r, 3), '換卡後第一問不該有前面的討論').not.toMatch(EARLIER);

    const failed = await askRig();
    await failed.view('teach.open');
    failed.askRouter.reply = 'not json';
    expect((await failed.askFull(Q(1))).ask?.error).toBe('unreadable');
    failed.askRouter.reply = askAnswer();
    await failed.askFull(Q(2));
    expect(promptOf(failed, 2), '失敗的那一輪不進討論').not.toMatch(EARLIER);
  });
});

describe('G7 answer 或追問只有空白 → unreadable', () => {
  it.each<[string, Obj]>([
    ['answer 只有空白', { answer: '   ' }],
    ['answer 只有換行', { answer: '\n\t' }],
    ['追問只有空白', { followups: ['  '] }],
    ['追問其中一個只有空白', { followups: ['好問題', ' \t '] }],
  ])('%s', async (_name, over) => {
    const r = await askRig();
    await r.view('teach.open');
    r.askRouter.reply = askAnswer(over);
    const res = await r.askFull(Q(1));
    expect(res.ask?.error, JSON.stringify(res.done)).toBe('unreadable');
    expect(res.ask?.answer).toBeUndefined();
    expect(res.ask?.highlight ?? null).toBeNull();
  });

  it('前後有空白但有字的 answer / 追問是好的,而且原樣帶回(不 trim)', async () => {
    const r = await askRig();
    await r.view('teach.open');
    r.askRouter.reply = askAnswer({ answer: ' 好的答案 ', followups: [' 再問 '] });
    const res = await r.askFull(Q(1));
    expect(res.ask?.answer).toBe(' 好的答案 ');
    expect(res.ask?.followups).toEqual([' 再問 ']);
  });
});

describe('G8 沒有 ask 的時候 teach.ask.poll 回純畫面', () => {
  it('沒問過、問完又換卡之後都是:ok、有卡、沒有 ask、不是 asking', async () => {
    const r = await askRig();
    await r.view('teach.open');
    for (const label of ['沒問過', '問完又換卡之後']) {
      if (label === '問完又換卡之後') {
        await r.askFull(Q(1));
        await r.view('teach.open');
      }
      const res = await r.send('teach.ask.poll');
      expect(res['ok'], label).toBe(true);
      const result = res['result'] as Obj;
      expect('ask' in result, label).toBe(false);
      expect(result['asking'], label).not.toBe(true);
      expect(cardIdOf(res), label).toBe(PARENT);
    }
  });

});

describe('G9 每種 error 的 message 非空,而且四種彼此不同', () => {
  it('unreadable / no-model / budget / failed(上限、帳本壞行、router 丟預算錯各自也都有訊息)', async () => {
    const messages: Record<string, string> = {};
    const collect = async (name: string, setup: (r: AskRig) => void, expectKind: string): Promise<void> => {
      const r = await askRig({ env: { LLM_DAILY_CAP_USD: '1' } });
      setup(r);
      await r.view('teach.open');
      const res = await r.askFull(Q(1));
      expect(res.ask?.error, name).toBe(expectKind);
      const m = String(res.ask?.message);
      expect(m.trim().length, `${name} 的訊息不能是空的`).toBeGreaterThan(0);
      messages[name] = m;
    };
    await collect('unreadable', (r) => (r.askRouter.reply = 'not json'), 'unreadable');
    await collect('no-model', (r) => (r.askRouter.reply = new NoModelError('teach.ask')), 'no-model');
    await collect('budget(router 丟)', (r) => (r.askRouter.reply = new DailyBudgetExceededError('teach.ask', 2, 1)), 'budget');
    await collect('failed', (r) => (r.askRouter.reply = new Error('x')), 'failed');
    await collect('budget(帳本壞行)', (r) => seedBadLedgerLine(r.v), 'budget');
    for (const name of ['unreadable', 'no-model', 'budget(router 丟)', 'failed']) {
      for (const other of ['unreadable', 'no-model', 'budget(router 丟)', 'failed']) if (name !== other) expect(messages[name], `${name} 與 ${other} 的訊息不該一樣`).not.toBe(messages[other]);
    }
  });
});
