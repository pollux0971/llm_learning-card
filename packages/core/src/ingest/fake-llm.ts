/**
 * Wave 0 的 FakeLlmRouter,實作 contracts/types.md §7 的 LlmRouter 介面。
 * 從 contracts/fixtures/llm/ 讀預錄回應重播,離線且確定性。I1 整合後改用
 * 03-llm-router 的真實實作(見 FEATURE.md「Wave 0 的重複」表)。
 *
 * 選檔規則(contracts/fixtures/llm/README.md):依 task + prompt_contains 選檔,
 * 同一組有多個 attempt 時依呼叫次數遞增。都不中就丟錯,不靜默回空字串。
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { LlmRouter, LlmTask, LlmResult } from './types.js';

export interface FakeFixtureRecord {
  task: LlmTask;
  prompt_contains: string;
  attempt: number;
  response: LlmResult;
}

/** 對應契約 §7 路由表:ingest.cards 系列離線時一律 throw CLOUD_REQUIRED,不降級。 */
export class CloudRequiredError extends Error {
  readonly code = 'CLOUD_REQUIRED';
  constructor(task: string) {
    super(`ingest 需要雲端模型(task=${task}),目前無法使用雲端,且不允許降級到本機模型`);
    this.name = 'CloudRequiredError';
  }
}

export interface FakeLlmRouterOptions {
  /** 從這個目錄讀 *.json 預錄回應,通常是 contracts/fixtures/llm。 */
  fixturesDir?: string;
  /** 額外的預錄回應,不落地也能用(給測試動態產生的情境)。跟 fixturesDir 的合併。 */
  extra?: FakeFixtureRecord[];
  /** true 時每次 call() 立刻丟 CloudRequiredError,模擬離線又不允許降級。 */
  cloudUnavailable?: boolean;
  /** 每次 call() 前呼叫,方便測試記錄呼叫次數(對應 world.llmCalls)。 */
  onCall?: (call: { task: string; prompt: string }) => void;
}

export class FakeLlmRouter implements LlmRouter {
  private readonly records: FakeFixtureRecord[];
  private readonly attemptCounts = new Map<string, number>();
  private readonly cloudUnavailable: boolean;
  private readonly onCall?: ((call: { task: string; prompt: string }) => void) | undefined;

  constructor(opts: FakeLlmRouterOptions = {}) {
    const fromDisk = opts.fixturesDir ? loadFixturesDir(opts.fixturesDir) : [];
    this.records = [...fromDisk, ...(opts.extra ?? [])];
    this.cloudUnavailable = opts.cloudUnavailable ?? false;
    this.onCall = opts.onCall;
  }

  async call(task: LlmTask, prompt: string): Promise<LlmResult> {
    this.onCall?.({ task, prompt });

    if (this.cloudUnavailable) {
      throw new CloudRequiredError(task);
    }

    const candidates = this.records.filter((r) => r.task === task && prompt.includes(r.prompt_contains));
    if (candidates.length === 0) {
      throw new Error(
        `FakeLlmRouter: 沒有預錄回應符合 task=${task}。忘記錄某個情境要立刻爆,不要靜默回空字串。`,
      );
    }

    const markers = [...new Set(candidates.map((c) => c.prompt_contains))];
    if (markers.length > 1) {
      throw new Error(
        `FakeLlmRouter: prompt 同時命中多組 prompt_contains(${markers.join(', ')}),marker 必須互斥`,
      );
    }
    const marker = markers[0]!;
    const key = `${task}::${marker}`;
    const attempt = (this.attemptCounts.get(key) ?? 0) + 1;
    this.attemptCounts.set(key, attempt);

    const rec = candidates.find((c) => c.attempt === attempt);
    if (!rec) {
      throw new Error(
        `FakeLlmRouter: task=${task} marker=${marker} 沒有錄第 ${attempt} 次呼叫的回應`,
      );
    }
    return rec.response;
  }

  async probeOnline(): Promise<boolean> {
    return !this.cloudUnavailable;
  }

  async probeLocal(): Promise<{ available: boolean; models: string[] }> {
    return { available: false, models: [] };
  }
}

function loadFixturesDir(dir: string): FakeFixtureRecord[] {
  if (!existsSync(dir)) return [];
  const out: FakeFixtureRecord[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const raw = JSON.parse(readFileSync(join(dir, name), 'utf8')) as FakeFixtureRecord;
    out.push(raw);
  }
  return out;
}
