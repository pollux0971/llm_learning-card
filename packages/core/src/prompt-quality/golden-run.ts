/**
 * golden run:對一個任務的固定輸入跑一次 router、把輸出、prompt 快照、
 * 執行環境(model/provider/日期/prompt 檔的 git commit)、評分表一起存到
 * `golden/<task>/<ISO date>/`。Wave 0 phase-1 只支援 fake 模式。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { FakeLlmRouter } from './fake-llm.js';
import { getGoldenSet, GOLDEN_SET_REGISTRY_FILE } from './golden-sets/registry.js';
import { runStructuralChecks } from './structural-checks.js';
import { renderScoresSheet } from './scores.js';
import type { GoldenOutput, GoldenRunMeta, GoldenRunResult, LlmRouter, LlmTask } from './types.js';

export const ROOT = resolve(import.meta.dirname, '../../../..');
/** live run(phase-2)的存放處:進 git,diff 看得到(FEATURE.md「golden 儲存」)。 */
export const DEFAULT_GOLDEN_BASE_DIR = join(ROOT, 'packages/core/src/prompt-quality/golden');
/**
 * fake run 的存放處:重播 fixture 的輸出沒有品質資訊,不值得進 git,
 * 所以放在 .gitignore 掉的目錄。CI / 單獨執行 `--golden --fake` 跑完 git status 仍是乾淨的。
 */
export const DEFAULT_FAKE_GOLDEN_BASE_DIR = join(ROOT, 'packages/core/src/prompt-quality/golden-fake');
export const DEFAULT_FAKE_FIXTURE_DIR = join(ROOT, 'packages/core/src/prompt-quality/fixtures/llm');

/** 沒指定 baseDir 時,依模式決定預設存放處。 */
export function defaultGoldenBaseDir(mode: GoldenRunMeta['mode']): string {
  return mode === 'fake' ? DEFAULT_FAKE_GOLDEN_BASE_DIR : DEFAULT_GOLDEN_BASE_DIR;
}

export class MissingGoldenSetError extends Error {
  constructor(public readonly task: string) {
    super(`task「${task}」沒有登記 golden set,去 ${GOLDEN_SET_REGISTRY_FILE} 定義它的固定輸入`);
    this.name = 'MissingGoldenSetError';
  }
}

export interface RunGoldenOptions {
  task: LlmTask;
  /** 這次 run 的日期,預設今天(YYYY-MM-DD)。同一天重跑會覆蓋同一個目錄。 */
  today?: string;
  /** 預設是自備的 FakeLlmRouter,phase-1 只有這個模式 */
  router?: LlmRouter;
  /** 每次呼叫 router.call 都會觸發,方便呼叫端(cucumber World)記錄 llmCalls */
  onCall?: (task: string, prompt: string) => void;
  /**
   * 存放根目錄。不給就依模式用 defaultGoldenBaseDir()。
   * 測試一律要傳暫存目錄,不要讓測試對 repo 裡的檔案讀寫或刪除(審核意見,ADR-032)。
   */
  baseDir?: string;
}

function gitCommitOf(relPath: string): string {
  const r = spawnSync('git', ['log', '-1', '--format=%h', '--', relPath], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const out = (r.stdout ?? '').trim();
  return out || 'uncommitted';
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function runGolden(opts: RunGoldenOptions): Promise<GoldenRunResult> {
  const set = getGoldenSet(opts.task);
  if (!set) throw new MissingGoldenSetError(opts.task);

  // Wave 0 phase-1 只有 fake 模式;live 是 phase-2。
  const mode: GoldenRunMeta['mode'] = 'fake';
  const date = opts.today ?? today();
  const baseDir = opts.baseDir ?? defaultGoldenBaseDir(mode);
  const dir = join(baseDir, set.task, date);
  mkdirSync(dir, { recursive: true });

  const router = opts.router ?? new FakeLlmRouter([DEFAULT_FAKE_FIXTURE_DIR], opts.onCall);

  const promptFileAbs = join(ROOT, set.promptFile);
  if (!existsSync(promptFileAbs)) {
    throw new Error(`golden set「${set.task}」指向的 prompt 檔不存在:${set.promptFile}`);
  }
  const promptContent = readFileSync(promptFileAbs, 'utf8');
  writeFileSync(join(dir, 'prompt.snapshot.md'), promptContent);

  const outputs: GoldenOutput[] = [];
  let model = 'unknown';
  let provider = 'unknown';
  for (const input of set.inputs) {
    const result = await router.call(set.task, input.prompt);
    model = result.model;
    provider = result.provider;
    const structural = runStructuralChecks(result.text);
    const output: GoldenOutput = { id: input.id, text: result.text, structural };
    writeFileSync(join(dir, `${input.id}.output.json`), JSON.stringify(output, null, 2));
    outputs.push(output);
  }

  const meta: GoldenRunMeta = {
    task: set.task,
    date,
    model,
    provider,
    promptFileGitCommit: gitCommitOf(set.promptFile),
    mode,
  };
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  writeFileSync(
    join(dir, 'SCORES.md'),
    renderScoresSheet(
      set.task,
      date,
      set.inputs.map((i) => i.id),
    ),
  );

  return { dir, meta, outputs };
}
