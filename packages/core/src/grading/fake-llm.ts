import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LlmResult, LlmRouter, LlmTask } from './types.js';

interface FixtureEntry {
  task: string;
  prompt_contains: string;
  attempt: number;
  response: LlmResult;
}

/** 讀 contracts/fixtures/llm/ 底下所有 *.json,格式見該目錄的 README.md */
export function loadFixturesFromDir(dir: string): FixtureEntry[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')) as FixtureEntry);
}

/**
 * Wave 0 的 LlmRouter stub。從預錄的 fixture 回應,不碰網路。
 * 依 task + prompt_contains 選檔;同一組有多個 attempt 時依呼叫次數遞增;
 * 都不中就丟錯——忘記錄某個情境要立刻爆,不要靜默回空字串。
 */
export class FakeLlmRouter implements LlmRouter {
  private readonly callCounts = new Map<string, number>();

  constructor(
    private readonly fixtures: FixtureEntry[],
    private readonly onCall?: (call: { task: string; prompt: string }) => void,
  ) {}

  async call(task: LlmTask, prompt: string): Promise<LlmResult> {
    this.onCall?.({ task, prompt });

    const candidates = this.fixtures
      .filter((f) => f.task === task && prompt.includes(f.prompt_contains))
      .sort((a, b) => b.prompt_contains.length - a.prompt_contains.length);
    if (!candidates.length) {
      throw new Error(`FakeLlmRouter: 沒有錄製 task=${task} 且符合 prompt 的 fixture`);
    }

    const promptContains = candidates[0]!.prompt_contains;
    const key = `${task}::${promptContains}`;
    const attempt = (this.callCounts.get(key) ?? 0) + 1;
    this.callCounts.set(key, attempt);

    const match = candidates.find((f) => f.prompt_contains === promptContains && f.attempt === attempt);
    if (!match) {
      throw new Error(`FakeLlmRouter: task=${task} prompt_contains=${promptContains} 沒有 attempt=${attempt} 的 fixture`);
    }
    return match.response;
  }

  async probeOnline(): Promise<boolean> {
    return false;
  }

  async probeLocal(): Promise<{ available: boolean; models: string[] }> {
    return this.fixtures.length > 0 ? { available: true, models: ['fake'] } : { available: false, models: [] };
  }
}
