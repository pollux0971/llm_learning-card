/**
 * T61 紅測試(CLI):scripts/ingest.ts --file 遇到壞的模型回應,印一行說明、退出碼 1、不印堆疊、一張卡都不寫。
 * 工單:docs/tickets/T61-ingest-bad-model-output-fails-clean.md「紅測試」的 CLI 那一條。測試 agent 寫;開發 worker 不改。
 *
 * 煞車(顧問 2026-10-27;T62 修好前):不帶 --fake 的 scripts/ingest.ts 只在下面三個條件都成立時才准起——
 *   (a) 帶 features/steps/_fake-cloud.mjs(換掉子行程的 globalThis.fetch,不打真網路);
 *   (b) 這個簽出沒有 .env(scripts/_env.ts 會載入 repo 根目錄的 .env;起之前先斷言它不存在,有就停,一個行程都不起);
 *   (c) 子行程的 HOME、XDG_CONFIG_HOME、XDG_CACHE_HOME 都指到這個測試自己建的暫存目錄(不依賴機器上的指標檔)。
 * 子行程的環境變數從零組起(只帶 PATH 與測試要的幾個),真的金鑰一個都帶不進去。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { RAW_SRC, cleanupTmps, mdFilesUnder, runIngestCli, stackLines, tmp, xdgPointingAt, type CliRun } from './ingest-cli-runner.js';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

afterAll(cleanupTmps);

/**
 * 起 CLI(共用的 ingest-cli-runner.ts 管煞車三條件)。指標檔指到 --out 自己,並寫好身分標記:
 * T62 之後不帶 --fake 的 ingest 一定要經驗證過的帳本;T62 之前這份指標檔不會被讀,對行為沒有影響。
 */
function runCli(outDir: string, extraEnv: Record<string, string>): CliRun {
  return runIngestCli(['--file', RAW_SRC, '--out', outDir, '--category', 'security'], { xdg: xdgPointingAt(outDir), env: extraEnv });
}

describe('T61 CLI:scripts/ingest.ts --file 遇到壞的模型回應', () => {
  it('退出碼 1、輸出有「模型回應格式不對」、整個輸出(除了「新建分類」那行)只有那一行、沒有以 at 開頭的堆疊行、cards/ 沒有任何卡、ingested.json 沒記這個檔', () => {
    const outDir = tmp('lc-t61-cli-');
    const run = runCli(outDir, { FAKE_CLOUD_LEVEL0_REPLY: 'not-json' });

    expect(run.status, `CLI 沒有正常結束(逾時或無法啟動):\n${run.output}`).not.toBeNull();
    expect(run.status, `退出碼要是 1:\n${run.output}`).toBe(1);
    expect(run.output, '要印出清楚的說明').toContain('模型回應格式不對');
    expect(stackLines(run.output), `不能印堆疊:\n${run.output}`).toEqual([]);
    const lines = run.output.split('\n').filter((l) => l.trim().length > 0 && !/^\(node:\d+\)|--trace-warnings|^新建分類 /.test(l));
    expect(run.output, '只留原本訊息的第一行').not.toContain('第二行');
    expect(lines, `失敗訊息只有一行:\n${run.output}`).toHaveLength(1);

    expect(mdFilesUnder(join(outDir, 'cards')), 'cards/ 不能有卡').toEqual([]);
    const ingested = join(outDir, 'state/ingested.json');
    const recorded = existsSync(ingested) ? (JSON.parse(readFileSync(ingested, 'utf8')) as Record<string, unknown>) : {};
    expect(Object.keys(recorded)).toEqual([]);
  });

  it('對照組:同一個 CLI、同一份假雲端,回應正常時照常寫卡、退出碼 0(證明上面那條紅的原因是壞回應,不是 CLI 起不來)', () => {
    const outDir = tmp('lc-t61-cli-ok-');
    const run = runCli(outDir, { FAKE_CLOUD_LEVEL0_COUNT: '2', FAKE_CLOUD_CHILDREN_PER_PARENT: '1' });
    expect(run.status, run.output).toBe(0);
    expect(mdFilesUnder(join(outDir, 'cards')).length, run.output).toBeGreaterThanOrEqual(2);
  });
});
