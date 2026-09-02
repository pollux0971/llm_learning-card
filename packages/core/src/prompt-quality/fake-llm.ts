/**
 * Wave 0 stub(契約 §7):自備 FakeLlmRouter,從預錄 fixture 讀回應,完全離線且確定性。
 * fixture 格式跟 contracts/fixtures/llm/README.md 描述的一致(task/prompt_contains/attempt/response),
 * 但這裡讀自己的目錄(fixtures/llm/),因為這組 fixture 只是 golden 框架的自我測試資料,
 * 不是真的任務 prompt——那是各功能(02/05...)自己的 fixture。
 *
 * 都不中就丟錯:忘記錄某個情境要立刻爆,不要靜默回空字串。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LlmResult, LlmRouter, LlmTask } from './types.js';

interface FixtureRecord {
  task: string;
  prompt_contains: string;
  attempt: number;
  response: LlmResult;
}

export class FixtureNotFoundError extends Error {
  constructor(task: string, prompt: string, attempt: number) {
    super(
      `FakeLlmRouter 找不到 fixture:task=${task} attempt=${attempt} prompt 開頭「${prompt.slice(0, 60)}」`,
    );
    this.name = 'FixtureNotFoundError';
  }
}

function loadFixtureDir(dir: string): FixtureRecord[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as FixtureRecord);
}

export class FakeLlmRouter implements LlmRouter {
  private readonly fixtures: FixtureRecord[];
  private readonly callCounts = new Map<string, number>();
  /** 每次 call() 的記錄,供呼叫端(如 World.llmCalls)斷言「只用了 fake、沒碰網路」 */
  readonly calls: { task: string; prompt: string }[] = [];

  constructor(
    fixtureDirs: string[],
    private readonly onCall?: (task: string, prompt: string) => void,
  ) {
    this.fixtures = fixtureDirs.flatMap(loadFixtureDir);
  }

  async call(task: LlmTask, prompt: string): Promise<LlmResult> {
    this.calls.push({ task, prompt });
    this.onCall?.(task, prompt);

    const candidates = this.fixtures.filter((f) => f.task === task && prompt.includes(f.prompt_contains));
    if (candidates.length === 0) throw new FixtureNotFoundError(task, prompt, 1);

    const marker = candidates[0]!.prompt_contains;
    const sameMarker = candidates.filter((f) => f.prompt_contains === marker);
    const key = `${task}::${marker}`;
    const count = (this.callCounts.get(key) ?? 0) + 1;
    this.callCounts.set(key, count);

    const match = sameMarker.find((f) => f.attempt === count) ?? sameMarker.find((f) => f.attempt === 1);
    if (!match) throw new FixtureNotFoundError(task, prompt, count);
    return match.response;
  }

  async probeOnline(): Promise<boolean> {
    return false;
  }

  async probeLocal(): Promise<{ available: boolean; models: string[] }> {
    return { available: false, models: [] };
  }
}
