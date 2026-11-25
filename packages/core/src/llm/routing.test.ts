import { describe, it, expect } from 'vitest';
import { decideRoute, ROUTING_TABLE, type RouteGroup } from './routing.js';
import { CloudRequiredError, NoModelError } from './errors.js';
import type { LlmTask } from './types.js';

/**
 * 對照 features/03-llm-router/phase-2.feature 的 Scenario Outline「Routing follows
 * the contract table」——11 組 Examples(T68 加 teach.ask 三組,共 14 組),一個 test case 對一列,不能合併,
 * routing.ts 是嚴格 95% 變異門檻(FEATURE.md)。
 *
 * decideRoute() 是純函式,這裡全部傳布林值,不碰任何 probeOnline/probeLocal——
 * 這樣才能在沒有真的本機模型的情況下(ADR-037)把整張表測滿。
 */

/** T68:`teach.ask` 還不在 LlmTask 型別裡的基底上,tsc 也要乾淨(紅測試不把型別弄壞);實作加進 LLM_TASKS 之後這個 cast 無害。 */
const ASK = 'teach.ask' as string as LlmTask;

type Outcome = 'cloud' | 'local' | 'local-provisional' | 'cloud-required' | 'no-model';

const TABLE_CASES: [task: LlmTask, online: boolean, local: boolean, outcome: Outcome][] = [
  ['ingest.cards', true, true, 'cloud'],
  ['ingest.cards', false, true, 'cloud-required'],
  ['ingest.deps', false, true, 'cloud-required'],
  ['deepen', true, true, 'cloud'],
  ['deepen', false, true, 'local-provisional'],
  ['deepen', false, false, 'no-model'],
  ['grade.fill.llm', true, true, 'local'],
  ['grade.fill.llm', true, false, 'no-model'],
  ['grade.apply', true, true, 'cloud'],
  ['grade.apply', false, true, 'local-provisional'],
  ['reteach.short', false, true, 'local-provisional'],
  // T68:契約 1.6.0 的 teach.ask,與 deepen 同一列(ADR-086)
  [ASK, true, true, 'cloud'],
  [ASK, false, true, 'local-provisional'],
  [ASK, false, false, 'no-model'],
];

describe('decideRoute — 契約 §7 路由表(phase-2.feature Scenario Outline 11 組 + T68 的 teach.ask 3 組 = 14 組全滿)', () => {
  it.each(TABLE_CASES)('task=%s online=%s local=%s → %s', (task, online, local, outcome) => {
    switch (outcome) {
      case 'cloud':
        expect(decideRoute({ task, online, local })).toEqual({ target: 'cloud', provisional: false });
        break;
      case 'local':
        expect(decideRoute({ task, online, local })).toEqual({ target: 'local', provisional: false });
        break;
      case 'local-provisional':
        expect(decideRoute({ task, online, local })).toEqual({ target: 'local', provisional: true });
        break;
      case 'cloud-required':
        expect(() => decideRoute({ task, online, local })).toThrow(CloudRequiredError);
        break;
      case 'no-model':
        expect(() => decideRoute({ task, online, local })).toThrow(NoModelError);
        break;
    }
  });

  it('CloudRequiredError 與 NoModelError 都點名是哪個 task', () => {
    expect(() => decideRoute({ task: 'ingest.cards', online: false, local: true })).toThrow(/ingest\.cards/);
    expect(() => decideRoute({ task: 'deepen', online: false, local: false })).toThrow(/deepen/);
    expect(() => decideRoute({ task: ASK, online: false, local: false })).toThrow(/teach\.ask/);
  });

  it('T68:teach.ask 跟 deepen 同一列:路由表的值相同、都是 cloud-or-local(不是自成一格)', () => {
    expect(ROUTING_TABLE[ASK]).toBe('cloud-or-local');
    expect(ROUTING_TABLE[ASK]).toBe(ROUTING_TABLE.deepen);
  });
});

describe('decideRoute — changing the routing table changes behaviour everywhere', () => {
  it('把 deepen 的路由表項目改成 cloud-only 後,離線呼叫改丟 CloudRequiredError——不用改 decideRoute 本身', () => {
    const patchedTable: Record<LlmTask, RouteGroup> = { ...ROUTING_TABLE, deepen: 'cloud-only' };

    expect(() => decideRoute({ task: 'deepen', online: false, local: true }, patchedTable)).toThrow(CloudRequiredError);
  });

  it('不給 table 參數時,預設吃 ROUTING_TABLE 本身(沒有被上一個測試的 patchedTable 汙染)', () => {
    expect(decideRoute({ task: 'deepen', online: false, local: true })).toEqual({ target: 'local', provisional: true });
  });
});
