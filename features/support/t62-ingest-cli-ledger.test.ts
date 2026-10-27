/**
 * T62 紅測試(CLI):`scripts/ingest.ts` 的真呼叫(--file、掃描、--topic)改走驗證過的帳本與當日上限(契約 §12)。
 * 工單:docs/tickets/T62-ingest-cli-verified-ledger.md「紅測試」。測試 agent 寫;開發 worker 不改。
 *
 * 全部真的起 CLI(不帶 --fake 的那些要守煞車三條件,見 ingest-cli-runner.ts:帶 _fake-cloud.mjs、簽出沒有 .env、HOME/XDG 指暫存)。
 * 每個測試自己建暫存指標檔(xdgPointingAt)或空的 XDG(emptyXdg),不依賴機器上的指標檔。
 * 假雲端會把收到的請求路徑記進 FAKE_CLOUD_REQUEST_LOG,所以「雲端被叫 0 次」是數出來的。
 *
 *   A. 拒絕:--file 帳本沒驗證過 → 退出碼 2、訊息有 vault.ts init 與 show、--out 一個位元組都不動、假雲端 0 個請求。
 *   B. 帳本位置:指標指到 A、--out 是 B → llm_call 記在 A,不在 B;卡在 B。
 *   C. 不花錢的路不要帳本:只標 stale 的掃描、已經生成過的主題。
 *   D. 掃描與 --topic 用到才解析:有新檔要生成 / 新主題 → 沒帳本退出碼 2。
 *   E. 預算:上限 US$1、帳本裡今天已花 US$1(seedTodaySpend;cap=0 不算用完) → --file 退出碼 1 一句話、掃描每個檔都進失敗清單、--topic 一句話;雲端 0 次叫模型。
 *   F. --fake 的行為不變:空的 XDG 也能跑,不碰指標檔。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { loadScan, makeLearning, rawText, treeHash, writeRaw } from '../../packages/core/src/ingest/t53-test-support.js';
import { topicRouter } from '../../packages/core/src/ingest/t55-test-support.js';
import { RAW_SRC, cleanupTmps, emptyXdg, mdFilesUnder, modelCalls, runIngestCli, seedTodaySpend, stackLines, tmp, xdgPointingAt } from './ingest-cli-runner.js';

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
afterAll(cleanupTmps);

const VAULT_INIT = 'vault.ts init';
const VAULT_SHOW = 'vault.ts show';

const fileArgs = (out: string): string[] => ['--file', RAW_SRC, '--out', out, '--category', 'security'];
const scanArgs = (out: string): string[] => ['--out', out, '--category', 'security'];
const logLines = (dir: string): Record<string, unknown>[] => {
  const p = join(dir, 'state/log.jsonl');
  return existsSync(p)
    ? readFileSync(p, 'utf8')
        .split('\n')
        .filter((l) => l.trim().length > 0)
        .map((l) => JSON.parse(l) as Record<string, unknown>)
    : [];
};
const llmCalls = (dir: string): Record<string, unknown>[] => logLines(dir).filter((e) => e['type'] === 'llm_call');

/** 一個有 security 分類、raw/security 底下有指定檔的學習資料夾 */
function learningWithRaw(names: string[]): string {
  const dir = makeLearning();
  for (const n of names) writeRaw(dir, 'security', n, rawText(n));
  return dir;
}

// ------------------------------------------------------------------ A. 拒絕

describe('T62 A. --file:帳本沒驗證過就拒絕,而且 --out 一個位元組都不動', () => {
  it('沒有指標檔、--out 還不存在:退出碼 2、訊息有 vault.ts init 與 show、--out 沒被建出來、假雲端 0 個請求、沒有堆疊', () => {
    const out = join(tmp('lc-t62-a1-'), 'does-not-exist-yet');
    const run = runIngestCli(fileArgs(out), { xdg: emptyXdg() });
    expect(run.status, run.output).toBe(2);
    expect(run.output).toContain(VAULT_INIT);
    expect(run.output).toContain(VAULT_SHOW);
    expect(stackLines(run.output), run.output).toEqual([]);
    expect(existsSync(out), '--out 連資料夾都不該被建出來').toBe(false);
    expect(run.requests, '拒絕時連探測都不能打').toEqual([]);
  });

  it('沒有指標檔、--out 是已經有東西的學習資料夾:樹前後逐位元組一樣(不建骨架、不建分類、不複製 raw)', () => {
    const out = makeLearning();
    const before = treeHash(out);
    const run = runIngestCli(fileArgs(out), { xdg: emptyXdg() });
    expect(run.status, run.output).toBe(2);
    expect(run.output).toContain(VAULT_INIT);
    expect(treeHash(out), '--out 被動過').toBe(before);
    expect(existsSync(join(out, 'raw/security')), '不能複製 raw').toBe(false);
    expect(run.requests).toEqual([]);
  });

  it('身分標記與指標檔不符:一樣退出碼 2、--out 不動', () => {
    const out = makeLearning();
    const xdg = xdgPointingAt(out, { markerOverride: 'not-the-right-id\n' });
    const before = treeHash(out);
    const run = runIngestCli(fileArgs(out), { xdg });
    expect(run.status, run.output).toBe(2);
    expect(run.output).toContain(VAULT_INIT);
    expect(treeHash(out)).toBe(before);
    expect(run.requests).toEqual([]);
  });

  it('指標檔指到不存在的資料夾:一樣退出碼 2', () => {
    const out = join(tmp('lc-t62-a4-'), 'out');
    const ghost = join(tmp('lc-t62-a4g-'), 'ghost-learning');
    const holder = tmp('lc-t62-a4h-');
    const xdg = xdgPointingAt(holder, { pointTo: ghost });
    const run = runIngestCli(fileArgs(out), { xdg });
    expect(run.status, run.output).toBe(2);
    expect(existsSync(out)).toBe(false);
    expect(run.requests).toEqual([]);
  });
});

// ------------------------------------------------------------------ B. 帳本位置

describe('T62 B. llm_call 記在驗證過的帳本,不是 --out', () => {
  it('指標指到 A、--out 是 B:A 的 state/log.jsonl 有 llm_call;B 沒有;卡在 B', () => {
    const ledgerDir = tmp('lc-t62-ledger-A-');
    const out = tmp('lc-t62-out-B-');
    const run = runIngestCli(fileArgs(out), { xdg: xdgPointingAt(ledgerDir), env: { FAKE_CLOUD_LEVEL0_COUNT: '2' } });
    expect(run.status, run.output).toBe(0);
    expect(mdFilesUnder(join(out, 'cards')).length, '卡寫在 --out(B)').toBeGreaterThanOrEqual(2);
    expect(llmCalls(ledgerDir).length, `驗證過的帳本(A)要有 llm_call:${run.output}`).toBeGreaterThan(0);
    expect(llmCalls(out), '--out(B)那本不能有 llm_call').toEqual([]);
    expect(mdFilesUnder(join(ledgerDir, 'cards')), '帳本資料夾不是輸出位置').toEqual([]);
  });

  it('指標指到 --out 自己(平常的用法):全在同一本,llm_call 與 ingested 都在', () => {
    const out = tmp('lc-t62-same-');
    const run = runIngestCli(fileArgs(out), { xdg: xdgPointingAt(out), env: { FAKE_CLOUD_LEVEL0_COUNT: '2' } });
    expect(run.status, run.output).toBe(0);
    expect(llmCalls(out).length).toBeGreaterThan(0);
    expect(logLines(out).some((e) => e['type'] === 'ingested')).toBe(true);
  });

  it('掃描(有新檔要生成)也一樣:llm_call 記在 A,不在 --out', () => {
    const ledgerDir = tmp('lc-t62-scan-ledger-');
    const out = learningWithRaw(['t62-scan-new.md']);
    const run = runIngestCli(scanArgs(out), { xdg: xdgPointingAt(ledgerDir), env: { FAKE_CLOUD_LEVEL0_COUNT: '2' } });
    expect(run.status, run.output).toBe(0);
    expect(mdFilesUnder(join(out, 'cards')).length).toBeGreaterThanOrEqual(2);
    expect(llmCalls(ledgerDir).length, run.output).toBeGreaterThan(0);
    expect(llmCalls(out)).toEqual([]);
  });
});

// ------------------------------------------------------------------ C. 不花錢的路

describe('T62 C. 不花錢的路,沒有帳本照樣能跑', () => {
  it('只標 stale 的掃描:空的 XDG、不帶 --fake、假雲端 0 個請求(連探測都沒有)→ 退出碼 0、卡被標 stale', () => {
    const dir = tmp('lc-t62-stale-');
    const first = runIngestCli(['--fake', '--file', RAW_SRC, '--out', dir, '--category', 'security'], { xdg: emptyXdg(), fakeCloud: false });
    expect(first.status, first.output).toBe(0);
    writeFileSync(join(dir, 'raw/security/security-basics.md'), rawText('edited'), 'utf8');
    const run = runIngestCli(scanArgs(dir), { xdg: emptyXdg() });
    expect(run.status, run.output).toBe(0);
    expect(run.output).not.toContain(VAULT_INIT);
    expect(run.requests, '只標 stale:不探測、不叫模型').toEqual([]);
    for (const f of mdFilesUnder(join(dir, 'cards/security'))) expect(readFileSync(f, 'utf8'), f).toMatch(/^stale: true$/m);
  });

  it('已經生成過的主題:空的 XDG、不帶 --fake → 退出碼 0、印「已經生成過」、假雲端 0 個請求', async () => {
    const scan = await loadScan();
    const dir = makeLearning([{ id: 'peach', name: '桃子', require_raw: false }]);
    const first = await scan({ outDir: dir, router: topicRouter().router, category: 'peach', topic: '光合作用 的基本過程', today: '2026-09-10', levelZeroOnly: true });
    expect(first.topicGenerated?.length).toBeGreaterThan(0);
    const cards = treeHash(join(dir, 'cards'));
    const run = runIngestCli(['--out', dir, '--category', 'peach', '--topic', '  光合作用   的基本過程 '], { xdg: emptyXdg() });
    expect(run.status, run.output).toBe(0);
    expect(run.output).toMatch(/已經生成過/);
    expect(run.output).not.toContain(VAULT_INIT);
    expect(run.requests).toEqual([]);
    expect(treeHash(join(dir, 'cards'))).toBe(cards);
  });
});

// ------------------------------------------------------------------ D. 用到才解析

describe('T62 D. 掃描與 --topic:要叫模型的時候才解析帳本,沒有就退出碼 2', () => {
  it('掃描有新檔要生成、空的 XDG:退出碼 2、訊息有 vault.ts init、一張卡都沒寫、沒叫模型', () => {
    const out = learningWithRaw(['t62-needs-ledger.md']);
    const run = runIngestCli(scanArgs(out), { xdg: emptyXdg() });
    expect(run.status, run.output).toBe(2);
    expect(run.output).toContain(VAULT_INIT);
    expect(run.output).toContain(VAULT_SHOW);
    expect(stackLines(run.output)).toEqual([]);
    expect(mdFilesUnder(join(out, 'cards'))).toEqual([]);
    expect(modelCalls(run)).toEqual([]);
  });

  it('--topic 新主題、空的 XDG:退出碼 2、訊息有 vault.ts init、沒寫卡、沒叫模型', () => {
    const dir = makeLearning([{ id: 'peach', name: '桃子', require_raw: false }]);
    const run = runIngestCli(['--out', dir, '--category', 'peach', '--topic', '光合作用'], { xdg: emptyXdg() });
    expect(run.status, run.output).toBe(2);
    expect(run.output).toContain(VAULT_INIT);
    expect(mdFilesUnder(join(dir, 'cards'))).toEqual([]);
    expect(modelCalls(run)).toEqual([]);
  });
});

// ------------------------------------------------------------------ E. 預算

describe('T62 E. 當日預算用完(上限 US$1、帳本裡今天已經花了 US$1):一句話、不寫卡、不叫模型', () => {
  // 注意 LLM_DAILY_CAP_USD=0 不是「用完」(isBudgetExhausted 對 cap <= 0 回 false = 沒設上限),所以種一筆今天的花費。
  const CAP1 = { LLM_DAILY_CAP_USD: '1' };

  it('--file:退出碼 1、訊息有「今日預算已用完」、沒有以 at 開頭的行、cards/ 沒有卡、雲端 0 次叫模型', () => {
    const out = tmp('lc-t62-e1-');
    seedTodaySpend(out, 1);
    const run = runIngestCli(fileArgs(out), { xdg: xdgPointingAt(out), env: CAP1 });
    expect(run.status, run.output).toBe(1);
    expect(run.output).toContain('今日預算已用完');
    expect(stackLines(run.output), `不能印堆疊:\n${run.output}`).toEqual([]);
    expect(mdFilesUnder(join(out, 'cards'))).toEqual([]);
    expect(modelCalls(run), '預算用完時雲端一次都不能叫').toEqual([]);
    expect(llmCalls(out).length, '沒有花錢,帳本不該多 llm_call(只剩種進去的那一筆)').toBe(1);
  });

  it('掃描兩個新檔:兩個都在失敗清單(沒有一個讓整個掃描停下)、沒有堆疊、沒寫卡、雲端 0 次叫模型', () => {
    const out = learningWithRaw(['t62-e-a.md', 't62-e-b.md']);
    seedTodaySpend(out, 1);
    const run = runIngestCli(scanArgs(out), { xdg: xdgPointingAt(out), env: CAP1 });
    expect(run.output).toContain('t62-e-a.md');
    expect(run.output).toContain('t62-e-b.md');
    expect(run.output).toContain('今日預算已用完');
    expect(stackLines(run.output), `不能印堆疊:\n${run.output}`).toEqual([]);
    expect(mdFilesUnder(join(out, 'cards'))).toEqual([]);
    expect(modelCalls(run)).toEqual([]);
  });

  it('--topic 新主題:印一句說明(提到預算)、沒有堆疊、沒寫卡、雲端 0 次叫模型', () => {
    const dir = makeLearning([{ id: 'peach', name: '桃子', require_raw: false }]);
    seedTodaySpend(dir, 1);
    const run = runIngestCli(['--out', dir, '--category', 'peach', '--topic', '光合作用'], { xdg: xdgPointingAt(dir), env: CAP1 });
    expect(run.output).toMatch(/預算/);
    expect(stackLines(run.output)).toEqual([]);
    expect(mdFilesUnder(join(dir, 'cards'))).toEqual([]);
    expect(modelCalls(run)).toEqual([]);
  });

  it('對照組:同一份指標、上限夠大 → 照常寫卡(證明上面的拒絕是預算造成的,不是 CLI 起不來)', () => {
    const out = tmp('lc-t62-e4-');
    const run = runIngestCli(fileArgs(out), { xdg: xdgPointingAt(out), env: { LLM_DAILY_CAP_USD: '100', FAKE_CLOUD_LEVEL0_COUNT: '2' } });
    expect(run.status, run.output).toBe(0);
    expect(mdFilesUnder(join(out, 'cards')).length).toBeGreaterThanOrEqual(2);
    expect(modelCalls(run).length).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------ F. --fake 不變

describe('T62 F. --fake 的行為不變:不碰指標檔', () => {
  it('--fake --file、空的 XDG:退出碼 0、卡寫出來、不需要帳本', () => {
    const out = tmp('lc-t62-f1-');
    const run = runIngestCli(['--fake', ...fileArgs(out)], { xdg: emptyXdg(), fakeCloud: false });
    expect(run.status, run.output).toBe(0);
    expect(run.output).not.toContain(VAULT_INIT);
    expect(mdFilesUnder(join(out, 'cards')).length).toBeGreaterThanOrEqual(1);
  });

  it('--fake 掃描有新檔、空的 XDG:照樣處理(用 FakeLlmRouter,不經帳本)', () => {
    const out = tmp('lc-t62-f2-');
    const first = runIngestCli(['--fake', ...fileArgs(out)], { xdg: emptyXdg(), fakeCloud: false });
    expect(first.status, first.output).toBe(0);
    const run = runIngestCli(['--fake', ...scanArgs(out)], { xdg: emptyXdg(), fakeCloud: false });
    expect(run.status, run.output).toBe(0);
    expect(run.output).not.toContain(VAULT_INIT);
  });
});
