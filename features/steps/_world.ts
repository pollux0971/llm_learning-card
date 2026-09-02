import { setWorldConstructor, World, IWorldOptions, Before } from '@cucumber/cucumber';
import { readFileSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * 所有步驟共用的狀態容器。
 *
 * 三個原則:
 * 1. 每個 scenario 一個新的 World,不共用狀態
 * 2. 需要寫入的 fixture 一律複製到暫存目錄再動,絕不修改 contracts/fixtures/
 * 3. lastResult 存放 When 的產出,Then 從這裡斷言
 */
export class LearningWorld extends World {
  /** 暫存的 learning 目錄,由 useFixture 建立 */
  dir?: string;
  /** 測試裡的「今天」,預設 2026-09-10 以配合 mid-cycle fixture */
  today = '2026-09-10';
  /** 最近一次 When 的結果,型別由各步驟自己收斂 */
  lastResult: unknown;
  /** 最近一次拋出的錯誤,給「應該失敗」的場景用 */
  lastError?: Error;
  /** FakeLlmRouter 記錄的呼叫,用來斷言「沒有呼叫模型」 */
  llmCalls: { task: string; prompt: string }[] = [];

  constructor(options: IWorldOptions) {
    super(options);
  }

  /** 把一份唯讀 fixture 複製到暫存目錄,回傳新路徑 */
  useFixture(name: string): string {
    const src = join('contracts/fixtures', name);
    const dst = mkdtempSync(join(tmpdir(), 'lc-'));
    cpSync(src, dst, { recursive: true });
    this.dir = dst;
    return dst;
  }

  /** 直接讀 fixture,不複製。只用於不會被修改的情況 */
  readFixture(relPath: string): string {
    return readFileSync(join('contracts/fixtures', relPath), 'utf8');
  }

  /** 讀暫存目錄裡的檔案 */
  read(relPath: string): string {
    if (!this.dir) throw new Error('尚未呼叫 useFixture');
    return readFileSync(join(this.dir, relPath), 'utf8');
  }

  cleanup(): void {
    if (this.dir) rmSync(this.dir, { recursive: true, force: true });
  }
}

setWorldConstructor(LearningWorld);

Before(function (this: LearningWorld) {
  this.llmCalls = [];
  this.lastError = undefined;
});
