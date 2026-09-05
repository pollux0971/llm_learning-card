/**
 * scripts/ingest.ts 的輸出格式測試。
 *
 * 守的是一件事:CLI 只印一個「建立了 N 張卡」。features/02-ingest-pipeline/REVIEW.md §7.6 第 1 點記的缺陷是
 * CLI 先自己算一個張數印表頭,下一行再印 result.message,兩個數字背靠背出現,
 * 操作者不知道到底建了幾張。修法是讓 message 自己就是唯一那個數字(見
 * runIngestPipeline()),CLI 不再另外算一個。
 *
 * 用 --fake 路徑跑:FakeLlmRouter 重播 contracts/fixtures/llm 的預錄回應,
 * 離線、確定性,不會打真的 API。
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../../../..');
const RAW_FIXTURE = 'contracts/fixtures/raw/security-basics.md';

/** 「建立了 N 張卡」這種宣告張數的行。冒號結尾的表頭也算,那正是舊的重複行。 */
const CARD_COUNT_LINE = /建立了\s*\d+\s*張卡/;

describe('scripts/ingest.ts 的輸出', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lc-ingest-cli-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('只印一個卡片張數,後面接建立的卡片 id', () => {
    const out = execFileSync(
      'npx',
      ['tsx', 'scripts/ingest.ts', '--fake', '--file', RAW_FIXTURE, '--out', dir],
      { cwd: ROOT, encoding: 'utf8' },
    );

    const countLines = out.split('\n').filter((line) => CARD_COUNT_LINE.test(line));
    expect(countLines, `輸出裡有多個卡片張數:\n${out}`).toHaveLength(1);

    // 張數要跟真的列出來的卡片 id 數量一致。
    const declared = Number(/建立了\s*(\d+)\s*張卡/.exec(countLines[0]!)![1]);
    const idLines = out.split('\n').filter((line) => /^ {2}\S+-\d{4}$/.test(line));
    expect(idLines).toHaveLength(declared);
  }, 120_000);
});
