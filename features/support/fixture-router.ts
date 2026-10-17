/**
 * 測試用的「重播預錄回應」router:取代 05-grading 的 Wave 0 `FakeLlmRouter`(I2 整合時移除)。
 *
 * 做法照 I2 的原則——**迴路裡的 router 是真的 `CloudLlmRouter`,只有最底下的 `CloudAdapter` 是假的**:
 * adapter 從 `contracts/fixtures/llm/*.json` 重播預錄回應(格式見該目錄的 README.md)。
 * 這樣被測的程式碼看到的就是 production 的 router(`provisional: false`、LlmTask 驗證、逾時競賽、記帳呼叫),
 * 不是一個行為略有不同的替身。
 *
 * 重播規則與舊的 `FakeLlmRouter` 完全相同(測試也是那份搬過來的,見 fixture-router.test.ts):
 *   - 依 `task` + `prompt_contains` 選檔,最長的 `prompt_contains` 勝;
 *   - 同一組(task + prompt_contains)的第 N 次呼叫要找 `attempt === N` 的那份,**找不到就丟錯**,不借用別組、不重播別次;
 *   - 一份都不中也丟錯——「忘記錄某個情境」要立刻爆,不要靜默回空字串。
 * `CloudAdapter.call` 看不到 task,所以包一層 router 在呼叫前把 task 記下來,adapter 從閉包裡讀(呼叫是序列的)。
 *
 * 為什麼在 `features/support/`:步驟檔(cucumber)與 vitest 都要用,而且不含 cucumber 相依
 * (理由見 `_router-guard.ts` 檔頭)。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CloudLlmRouter, NoModelError } from '@core/llm/index.js';
import type { CloudAdapter, LlmRouter, LlmTask } from '@core/llm/index.js';

export interface FixtureEntry {
  task: string;
  prompt_contains: string;
  attempt: number;
  response: { text: string; provider?: string; model?: string; latency_ms?: number; provisional?: boolean };
}

/** 讀 contracts/fixtures/llm/ 底下所有 *.json。 */
export function loadFixturesFromDir(dir: string): FixtureEntry[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')) as FixtureEntry);
}

export interface RecordedCall {
  task: string;
  prompt: string;
}

/** 重播預錄回應的假 CloudAdapter。`currentTask` 由外層 router 在每次呼叫前設定。 */
export function replayAdapter(fixtures: FixtureEntry[], currentTask: () => string): CloudAdapter {
  const callCounts = new Map<string, number>();
  return {
    async call({ prompt, model }) {
      const task = currentTask();
      const candidates = fixtures
        .filter((f) => f.task === task && prompt.includes(f.prompt_contains))
        .sort((a, b) => b.prompt_contains.length - a.prompt_contains.length);
      if (!candidates.length) {
        throw new Error(`fixture-router: 沒有錄製 task=${task} 且符合 prompt 的 fixture`);
      }
      const promptContains = candidates[0]!.prompt_contains;
      const key = `${task}::${promptContains}`;
      const attempt = (callCounts.get(key) ?? 0) + 1;
      callCounts.set(key, attempt);
      const match = candidates.find((f) => f.prompt_contains === promptContains && f.attempt === attempt);
      if (!match) {
        throw new Error(`fixture-router: task=${task} prompt_contains=${promptContains} 沒有 attempt=${attempt} 的 fixture`);
      }
      return { text: match.response.text, provider: 'openai', model, latency_ms: match.response.latency_ms ?? 0 };
    },
  };
}

/**
 * 真的 CloudLlmRouter + 重播 adapter。`onCall` 在每次 `call` 一開始(不管有沒有對應 fixture)回報 task 與 prompt。
 * 記帳明確關掉(`logAppender: () => {}`,ADR-050 要求「要不記帳就明講」)。
 */
export function fixtureRouter(fixtures: FixtureEntry[], onCall?: (call: RecordedCall) => void): LlmRouter {
  let current = '';
  const inner = new CloudLlmRouter({
    env: { LLM_CLOUD_PROVIDER: 'openai', LLM_CLOUD_MODEL: 'recorded', OPENAI_API_KEY: 'fixture-key' },
    adapters: { openai: replayAdapter(fixtures, () => current) },
    logAppender: () => {},
  });
  return {
    async call(task: LlmTask, prompt: string, opts?: { timeoutMs?: number; maxTokens?: number }) {
      current = task;
      onCall?.({ task, prompt });
      return inner.call(task, prompt, opts);
    },
    // 離線的假環境:不打網路。舊的 FakeLlmRouter 也是這兩個答案。
    async probeOnline() {
      return false;
    },
    async probeLocal() {
      return fixtures.length > 0 ? { available: true, models: ['fake'] } : { available: false, models: [] };
    },
  };
}

/**
 * T31:有些場景只檢查「第三層(填空同義判斷)被打到」,沒有為那個 prompt 錄 fixture(例如「Short answers skip the fuzzy layer」)。
 * 以前 `gradeFillBlank` 把任何例外都收成嚴格比對,那些場景就靠「沒錄」這個例外走到 fallback-strict。
 * T31 之後只有「模型不能用」才收,所以這裡明講:沒錄製 = 沒有模型(NoModelError,`cause` 留著原本那個「沒有錄製」的錯)。
 * 只轉換「沒有錄製」這一種;其他的錯(包括對不上 attempt)原樣丟出。要真的驗回應的場景自己錄 fixture,不要包這層。
 */
export function noRecordingIsNoModel(router: LlmRouter): LlmRouter {
  return {
    async call(task: LlmTask, prompt: string, opts?: { timeoutMs?: number; maxTokens?: number }) {
      try {
        return await router.call(task, prompt, opts);
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('fixture-router: 沒有錄製')) {
          throw new NoModelError(task, { detail: '沒有預錄的回應', cause: err });
        }
        throw err;
      }
    },
    probeOnline: () => router.probeOnline(),
    probeLocal: () => router.probeLocal(),
  };
}
