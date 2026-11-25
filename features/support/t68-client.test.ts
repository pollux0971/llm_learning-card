/**
 * T68(07 phase-6 問 AI)視窗端的 ReviewClient:`apps/desktop/src/webview/review-client.ts` 加兩個方法(ADR-086;工單只寫 `teachAsk()`,
 * 輪詢 `teach.ask.poll` 也要有對應方法,名字由這份測試固定:`teachAsk(question)`、`teachAskPoll()`)。測試 agent 寫;開發 worker 不改。
 *
 * 量的是「送出去的那一行」:協定信封(v:1、id、method、params)、params 只有 question(不帶路徑、卡 id)、poll 的 params 是空物件;
 * 回的是側車回應的 result 物件;側車回錯誤(例如 bad-request)就丟 ReviewError、kind 照搬。
 * 程序內 handler(`createReviewClient({ handler })`)接一個記錄請求的假側車;方法用 Record 取,不寫死型別,基底上是「還沒有這個方法」而紅,不是 tsc 錯。
 */
import { describe, expect, it } from 'vitest';
import { createReviewClient, ReviewError } from '../../apps/desktop/src/webview/review-client.js';

type Obj = Record<string, unknown>;

function rig(reply: (req: Obj) => Obj) {
  const sent: Obj[] = [];
  const handler = async (line: string): Promise<string> => {
    const req = JSON.parse(line) as Obj;
    sent.push(req);
    return JSON.stringify({ v: 1, id: req['id'], ...reply(req) });
  };
  const client = createReviewClient({ handler }) as unknown as Record<string, (...args: unknown[]) => Promise<Obj>>;
  return { client, sent };
}

describe('T68 ReviewClient.teachAsk / teachAskPoll', () => {
  it('兩個方法存在;teachAsk 收一個參數(問題),teachAskPoll 不收參數', () => {
    const { client } = rig(() => ({ ok: true, result: {} }));
    expect(typeof client['teachAsk'], 'teachAsk').toBe('function');
    expect(typeof client['teachAskPoll'], 'teachAskPoll').toBe('function');
    expect(client['teachAsk']!.length).toBe(1);
    expect(client['teachAskPoll']!.length).toBe(0);
  });

  it('teachAsk(question) 送 { v:1, id, method:"teach.ask", params:{ question } }——params 只有 question', async () => {
    const { client, sent } = rig(() => ({ ok: true, result: { asking: true } }));
    const got = await client['teachAsk']!('為什麼可以丟掉一半?');
    expect(got).toEqual({ asking: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ v: 1, method: 'teach.ask', params: { question: '為什麼可以丟掉一半?' } });
    expect(Object.keys(sent[0]!['params'] as Obj)).toEqual(['question']);
    expect(Object.keys(sent[0]!).sort()).toEqual(['id', 'method', 'params', 'v']);
  });

  it('teachAskPoll() 送 teach.ask.poll、params 是空物件;回側車的 result(進行中與完成都原樣)', async () => {
    const answers: Obj[] = [{ asking: true }, { card: null, ask: { answer: 'x', provisional: false, suggestion: 'none', highlight: null, followups: [] } }];
    const { client, sent } = rig(() => ({ ok: true, result: answers.shift()! }));
    expect(await client['teachAskPoll']!()).toEqual({ asking: true });
    const done = await client['teachAskPoll']!();
    expect((done['ask'] as Obj)['answer']).toBe('x');
    expect(sent.map((s) => [s['method'], s['params']])).toEqual([['teach.ask.poll', {}], ['teach.ask.poll', {}]]);
  });

  it('側車回 bad-request(例如 deepen 跑著時問、或一次只能一個):丟 ReviewError,kind 照搬、字樣是固定那一句', async () => {
    const { client } = rig(() => ({ ok: false, error: { kind: 'bad-request', message: '這一列不是合法的請求。' } }));
    const err = await client['teachAsk']!('x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ReviewError);
    expect((err as ReviewError).kind).toBe('bad-request');
  });

  it('id 每次加一(跟別的方法共用同一個計數)', async () => {
    const { client, sent } = rig(() => ({ ok: true, result: {} }));
    await client['teachNext']!();
    await client['teachAsk']!('a');
    await client['teachAskPoll']!();
    expect(sent.map((s) => s['id'])).toEqual([1, 2, 3]);
  });
});
