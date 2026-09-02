#!/usr/bin/env node
/**
 * 02-ingest-pipeline 的 CLI 入口。Wave 0 只支援 --fake(FakeLlmRouter)。
 *
 * 用法:
 *   npx tsx scripts/ingest.ts --fake --file <raw file> --out <learning dir> [--category <id>]
 *
 * 退出碼:0 成功(含「已經處理過」);1 失敗(空檔案、找不到檔案、雲端模型不可用)。
 */
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { FakeLlmRouter } from '../packages/core/src/ingest/fake-llm.js';
import { runIngest } from '../packages/core/src/ingest/ingest.js';
import { ensureInitialized, setCategory } from '../packages/core/src/ingest/init.js';

const ROOT = resolve(import.meta.dirname, '..');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const useFake = process.argv.includes('--fake');
  const filePath = arg('--file');
  const outDir = arg('--out');
  const category = arg('--category') ?? 'security';

  if (!filePath || !outDir) {
    console.error('用法: ingest.ts --fake --file <raw file> --out <learning dir> [--category <id>]');
    process.exit(1);
  }
  if (!useFake) {
    console.error('Wave 0 只支援 --fake(FakeLlmRouter)。真的 router 等 03-llm-router 整合後才有(I1)。');
    process.exit(1);
  }

  const absOut = resolve(outDir);
  ensureInitialized(absOut);
  setCategory(absOut, { id: category, name: category, require_raw: true });

  const srcAbs = resolve(filePath);
  if (!existsSync(srcAbs)) {
    console.error(`找不到檔案:${filePath}`);
    process.exit(1);
  }

  const base = basename(srcAbs);
  const rawRelPath = `raw/${category}/${base}`;
  const rawAbs = join(absOut, rawRelPath);
  mkdirSync(dirname(rawAbs), { recursive: true });
  copyFileSync(srcAbs, rawAbs);

  const fixturesDir = join(ROOT, 'contracts/fixtures/llm');
  const router = new FakeLlmRouter({ fixturesDir });

  const result = await runIngest({ outDir: absOut, rawRelPath, category, router });

  if (result.cardsCreated.length > 0) {
    console.log(`建立了 ${result.cardsCreated.length} 張卡:`);
    for (const id of result.cardsCreated) console.log(`  ${id}`);
  }
  console.log(result.message);
  process.exit(result.exitCode);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
