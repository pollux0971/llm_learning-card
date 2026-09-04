/**
 * spend.ts 的單元測試(ADR-039)。
 *
 * 重點是**邊界**:剛好等於上限算不算用完。ADR-039 決定 `spent >= cap` 就算達到,
 * 理由是上限是天花板不是配額目標,而且 log 算出來的數字是低估(進行中還沒寫 log
 * 的那次呼叫不在裡面)。錢的方向上保守比較安全。這裡把三個點都釘住:
 * 剛好低於 / 剛好等於 / 剛好高於。
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LogEvent } from '@contracts/index.js';
import {
  DEFAULT_DAILY_CAP_USD,
  DEFAULT_SPEND_PRICES,
  computeDailySpend,
  dayOf,
  isBudgetExhausted,
  isLlmCallEvent,
  readDailyCapUsd,
  readDailySpend,
  readSpendPrices,
  type SpendPrices,
} from './spend.js';

const PRICES: SpendPrices = { inPerM: 2.5, outPerM: 10 };
const TODAY = '2026-09-04';

function event(partial: Record<string, unknown>): LogEvent {
  return {
    ts: `${TODAY}T09:30:00+08:00`,
    type: 'llm_call',
    task: 'deepen',
    provider: 'openai',
    model: 'gpt-5.6-luna',
    latency_ms: 100,
    ...partial,
  } as unknown as LogEvent;
}

describe('isLlmCallEvent', () => {
  it('只認 llm_call 而且 provider 是 openai 的事件', () => {
    expect(isLlmCallEvent(event({}))).toBe(true);
  });

  it('閘道的呼叫不算——跑在使用者自己的硬體上,免費', () => {
    expect(isLlmCallEvent(event({ provider: 'ollama' }))).toBe(false);
  });

  it('anthropic 也不算:ADR-034 決定雲端只用 OpenAI,預算就是 OpenAI 的預算', () => {
    expect(isLlmCallEvent(event({ provider: 'anthropic' }))).toBe(false);
  });

  it('其他型別的事件不算', () => {
    expect(isLlmCallEvent(event({ type: 'learned' }))).toBe(false);
  });
});

describe('dayOf', () => {
  it('把 ISO 8601 切成 YYYY-MM-DD', () => {
    expect(dayOf('2026-09-04T09:30:00+08:00')).toBe('2026-09-04');
  });

  it('取本地日期,對齊使用者感受到的「今天」', () => {
    const local = new Date('2026-09-04T23:30:00+08:00');
    const expected = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`;
    expect(dayOf('2026-09-04T23:30:00+08:00')).toBe(expected);
  });
});

describe('computeDailySpend', () => {
  it('沒有事件就是零元零筆', () => {
    expect(computeDailySpend([], TODAY, PRICES)).toEqual({ usd: 0, calls: 0 });
  });

  it('輸入與輸出 token 各自乘上自己的價格', () => {
    // 1,000,000 in × $2.5/M = $2.5;500,000 out × $10/M = $5 → 共 $7.5
    const spend = computeDailySpend([event({ tokens_in: 1_000_000, tokens_out: 500_000 })], TODAY, PRICES);
    expect(spend.usd).toBeCloseTo(7.5, 10);
    expect(spend.calls).toBe(1);
  });

  it('多筆事件相加', () => {
    const spend = computeDailySpend(
      [event({ tokens_out: 100_000 }), event({ tokens_out: 100_000 })],
      TODAY,
      PRICES,
    );
    expect(spend.usd).toBeCloseTo(2, 10);
    expect(spend.calls).toBe(2);
  });

  it('別天的事件不算進來', () => {
    const spend = computeDailySpend(
      [event({ ts: '2026-09-03T09:30:00+08:00', tokens_out: 1_000_000 })],
      TODAY,
      PRICES,
    );
    expect(spend).toEqual({ usd: 0, calls: 0 });
  });

  it('閘道的呼叫不計費,連筆數都不算', () => {
    const spend = computeDailySpend(
      [event({ provider: 'ollama', tokens_in: 5_000_000, tokens_out: 5_000_000 })],
      TODAY,
      PRICES,
    );
    expect(spend).toEqual({ usd: 0, calls: 0 });
  });

  it('沒有 token 欄位的事件(逾時、截斷)算一筆但零元', () => {
    const spend = computeDailySpend([event({ timeout: true, timeout_ms: 60_000 })], TODAY, PRICES);
    expect(spend).toEqual({ usd: 0, calls: 1 });
  });

  it('只有 tokens_out 沒有 tokens_in 也算得出來', () => {
    const spend = computeDailySpend([event({ tokens_out: 200_000 })], TODAY, PRICES);
    expect(spend.usd).toBeCloseTo(2, 10);
  });

  it('是純函式:不改動傳進來的事件陣列', () => {
    const events = [event({ tokens_out: 100_000 })];
    const snapshot = JSON.stringify(events);
    computeDailySpend(events, TODAY, PRICES);
    expect(JSON.stringify(events)).toBe(snapshot);
  });
});

describe('isBudgetExhausted — ADR-039 的邊界決定', () => {
  it('低於上限:還有預算', () => {
    expect(isBudgetExhausted(0.999_9, 1)).toBe(false);
  });

  it('**剛好等於上限就算用完**(>= 不是 >)', () => {
    expect(isBudgetExhausted(1, 1)).toBe(true);
  });

  it('超過上限:用完', () => {
    expect(isBudgetExhausted(1.000_1, 1)).toBe(true);
  });

  it('零花費從來不算用完', () => {
    expect(isBudgetExhausted(0, 1)).toBe(false);
  });

  it('上限是 0 視為「沒有上限」,不讓整個系統停擺', () => {
    expect(isBudgetExhausted(999, 0)).toBe(false);
  });

  it('上限是負數同樣視為沒有上限', () => {
    expect(isBudgetExhausted(999, -1)).toBe(false);
  });
});

describe('readSpendPrices / readDailyCapUsd', () => {
  it('讀環境變數', () => {
    expect(readSpendPrices({ LLM_PRICE_IN_PER_M: '3', LLM_PRICE_OUT_PER_M: '12' })).toEqual({ inPerM: 3, outPerM: 12 });
    expect(readDailyCapUsd({ LLM_DAILY_CAP_USD: '5' })).toBe(5);
  });

  it('沒設就用預設值', () => {
    expect(readSpendPrices({})).toEqual(DEFAULT_SPEND_PRICES);
    expect(readDailyCapUsd({})).toBe(DEFAULT_DAILY_CAP_USD);
  });

  it('不是數字就退回預設值,不丟錯', () => {
    expect(readSpendPrices({ LLM_PRICE_IN_PER_M: 'abc', LLM_PRICE_OUT_PER_M: '' })).toEqual(DEFAULT_SPEND_PRICES);
    expect(readDailyCapUsd({ LLM_DAILY_CAP_USD: 'abc' })).toBe(DEFAULT_DAILY_CAP_USD);
  });

  it('負數的價格退回預設值', () => {
    expect(readSpendPrices({ LLM_PRICE_IN_PER_M: '-1', LLM_PRICE_OUT_PER_M: '-2' })).toEqual(DEFAULT_SPEND_PRICES);
  });

  it('上限可以明確設成 0(表示不設限),不會被當成「沒設」', () => {
    expect(readDailyCapUsd({ LLM_DAILY_CAP_USD: '0' })).toBe(0);
  });

  // 只有空白的值必須當成「沒設」。少了 .trim() 的話 Number('   ') 是 0,
  // 而 0 的意思是「不設限」——一個手滑打成空白的環境變數會**靜默關掉預算上限**。
  // 錢的方向上這是最糟的失敗,所以單獨鎖住。
  it('ts 不是字串的事件不算——契約 §10 說 ts 是 ISO 8601 字串', () => {
    // 少了 typeof 檢查的話,`ts` 是 epoch 毫秒(數字)的一行會被 new Date() 接受、
    // 算出一個真的日期,於是一筆形狀壞掉的紀錄被當成今天的花費算進帳。
    const day = '2026-09-04';
    const numericTs = Date.parse('2026-09-04T10:00:00+08:00');
    const events = [
      { ts: numericTs, type: 'llm_call', provider: 'openai', tokens_out: 1_000_000 },
      { type: 'llm_call', provider: 'openai', tokens_out: 1_000_000 },
    ] as unknown as LogEvent[];
    expect(computeDailySpend(events, day, { inPerM: 2.5, outPerM: 10 })).toEqual({ usd: 0, calls: 0 });
  });

  it('只有空白的環境變數當成沒設,不會變成「不設限」的 0', () => {
    expect(readDailyCapUsd({ LLM_DAILY_CAP_USD: '   ' })).toBe(DEFAULT_DAILY_CAP_USD);
    expect(readDailyCapUsd({ LLM_DAILY_CAP_USD: '\t\n' })).toBe(DEFAULT_DAILY_CAP_USD);
    expect(readSpendPrices({ LLM_PRICE_IN_PER_M: '  ', LLM_PRICE_OUT_PER_M: ' ' })).toEqual(DEFAULT_SPEND_PRICES);
  });
});

describe('readDailySpend', () => {
  it('讀 log.jsonl 算出當日花費', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spend-test-'));
    try {
      const logPath = join(dir, 'log.jsonl');
      writeFileSync(
        logPath,
        [event({ tokens_out: 100_000 }), event({ ts: '2026-09-03T09:30:00+08:00', tokens_out: 900_000 })]
          .map((e) => JSON.stringify(e))
          .join('\n') + '\n',
      );
      const spend = readDailySpend(logPath, TODAY, PRICES);
      expect(spend.usd).toBeCloseTo(1, 10);
      expect(spend.calls).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('壞掉的一行只跳過那一行,其他行照算', () => {
    // 整份放棄會把花費算成 0,而 0 的方向是「還可以繼續花」——錢的方向上不能這樣錯。
    // 寫 log 中途被砍掉會留下半行,所以這不是假想的情況。
    const dir = mkdtempSync(join(tmpdir(), 'spend-test-'));
    try {
      const logPath = join(dir, 'log.jsonl');
      writeFileSync(
        logPath,
        [
          JSON.stringify(event({ tokens_out: 500_000 })),
          '{"ts":"2026-09-04T10:00:00+08:00","type":"llm_ca',  // 被砍斷的半行
          'not json at all',
          '',
          '   ',
          JSON.stringify(event({ tokens_out: 500_000 })),
        ].join('\n') + '\n',
      );
      const spend = readDailySpend(logPath, TODAY, PRICES);
      expect(spend.calls).toBe(2);
      expect(spend.usd).toBeCloseTo(10, 10);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('log 檔不存在就是還沒花錢,不丟錯', () => {
    expect(readDailySpend(join(tmpdir(), 'definitely-not-there', 'log.jsonl'), TODAY, PRICES)).toEqual({
      usd: 0,
      calls: 0,
    });
  });
});
