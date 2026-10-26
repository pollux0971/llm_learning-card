#!/usr/bin/env node
/**
 * 02-ingest-pipeline 的 CLI 入口。
 *
 * I1 整合缺口(runIngestPipeline() 已實作,見 packages/core/src/ingest/ingest.ts
 * 與 packages/core/src/ingest/pipeline.test.ts、features/steps/i1-content-pipeline.steps.ts):
 * 過去 Wave 0 這裡硬寫死只認 --fake,遇到沒帶 --fake 就直接印訊息 exit 1,
 * 字面上就是在等 03-llm-router 整合完成——現在 LlmRouterImpl 已經做完,
 * 這個入口預設用真的 router,--fake 變成明確要求時才用的選項。
 *
 * 用法:
 *   npx tsx scripts/ingest.ts --file <raw file> --out <learning dir> [--category <id>]
 *   npx tsx scripts/ingest.ts --fake --file <raw file> --out <learning dir> [--category <id>]
 *   npx tsx scripts/ingest.ts [--fake] --out <learning dir> [--category <id>] [--topic <文字>]
 *
 * 不給 --file 就是掃描 / 主題跑法(T53):讀 categories.yaml,不建沒設定的分類。
 * --file 仍是刻意的例外:分類不存在才建(require_raw: true,印「新建分類」),已存在不覆寫。
 * raw/<分類>/<檔名> 已存在且內容不同就拒絕,不覆寫。
 *
 * --fake:用 FakeLlmRouter 重播 contracts/fixtures/llm 的預錄回應,離線、確定性。
 *   只呼叫 runIngest()(level 0 卡片),不呼叫 runIngestPipeline()——fixtures 目錄
 *   目前只錄了 'ingest.cards' 的回應,沒有 'ingest.questions' / 'ingest.deps',
 *   接上完整管線前得先補這些 fixture,不是這輪的範圍。standalone.json 與很多
 *   測試靠這個路徑做確定性測試,行為不變。
 *
 * 不帶 --fake(預設):用 LlmRouterImpl(真的 CloudLlmRouter,讀 config/settings.yaml
 *   的 llm 設定,環境變數 LLM_CLOUD_PROVIDER / LLM_CLOUD_MODEL / LLM_LOCAL_MODEL
 *   覆蓋,契約 §11)。跑之前先 probeOnline() 探測:探測不到就照
 *   「Offline ingest refuses rather than degrading」場景的字面行為——不寫任何
 *   卡片、印出需要雲端模型的訊息、exit 1,不透過 runIngest() 內部的
 *   CloudRequiredError catch(那條 catch 現在看契約 §7 路由表共用的
 *   code === 'CLOUD_REQUIRED',fake-llm.ts 與 @core/llm/errors.js 已經統一成
 *   同一個 class,見 ingest.ts 的 isCloudRequiredError() 註解)。探測到線上就呼叫
 *   runIngestPipeline(),接上 phase-2 的 questions/children/deps 三步。
 *
 * 退出碼:0 成功(含「已經處理過」);1 失敗(空檔案、找不到檔案、離線,或
 *   任何一張卡的考題產生失敗——見 hasQuestionFailures)。
 */
import './_env.js';
import { mkdirSync, copyFileSync, existsSync, lstatSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { parse as yamlParse } from 'yaml';
import { FakeLlmRouter } from '../packages/core/src/ingest/fake-llm.js';
import { runIngest, runIngestPipeline } from '../packages/core/src/ingest/ingest.js';
import { ensureInitialized, listCategories, setCategory } from '../packages/core/src/ingest/init.js';
import { runIngestScan, type ScanResult } from '../packages/core/src/ingest/scan.js';
import { LlmRouterImpl, type RouterSettings } from '../packages/core/src/llm/router-impl.js';
import { formatCategoryIdRefusal, validateCategoryId } from '../packages/core/src/schema/category-id.js';

const ROOT = resolve(import.meta.dirname, '..');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** 讀 outDir/config/settings.yaml 的 llm 區塊,給 LlmRouterImpl 當 settings(契約 §11)。 */
function readLlmSettings(outDir: string): RouterSettings {
  const settingsPath = join(outDir, 'config/settings.yaml');
  if (!existsSync(settingsPath)) return {};
  const parsed = yamlParse(readFileSync(settingsPath, 'utf8')) as { llm?: RouterSettings } | null;
  return parsed?.llm ?? {};
}

function rawDestKind(path: string): 'missing' | 'file' | 'other' {
  try {
    const st = lstatSync(path);
    if (st.isSymbolicLink() || !st.isFile()) return 'other';
    return 'file';
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    throw err;
  }
}

function sameFileBytes(a: string, b: string): boolean {
  const left = readFileSync(a);
  const right = readFileSync(b);
  return left.length === right.length && left.equals(right);
}

function finishScan(result: ScanResult): never {
  if (result.refused || result.cloudBlocked) {
    console.error(result.message);
    process.exit(1);
  }
  console.log(result.message);
  process.exit(0);
}

async function runScanCli(opts: { useFake: boolean; outDir: string; category?: string; topic?: string }): Promise<void> {
  const absOut = resolve(opts.outDir);
  const scanOpts = {
    outDir: absOut,
    ...(opts.category !== undefined ? { category: opts.category } : {}),
    ...(opts.topic !== undefined ? { topic: opts.topic } : {}),
  };
  // 掃描自己決定要不要探測:沒有新檔(只標 stale / source_missing、或拒絕)不碰網路。
  // CLI 這裡不先 probeOnline,否則離線、沒有金鑰的「只標 stale」會被擋下。
  if (opts.useFake) {
    const fixturesDir = join(ROOT, 'contracts/fixtures/llm');
    const result = await runIngestScan({
      ...scanOpts,
      router: new FakeLlmRouter({ fixturesDir }),
      levelZeroOnly: true,
    });
    finishScan(result);
  }

  const result = await runIngestScan({
    ...scanOpts,
    router: new LlmRouterImpl({
      settings: readLlmSettings(absOut),
      logPath: join(absOut, 'state/log.jsonl'),
    }),
    levelZeroOnly: false,
  });
  finishScan(result);
}

async function main(): Promise<void> {
  const useFake = process.argv.includes('--fake');
  const filePath = arg('--file');
  const outDir = arg('--out');
  const categoryArg = arg('--category');
  const topic = arg('--topic');

  if (!outDir) {
    console.error('用法: ingest.ts [--fake] --file <raw file> --out <learning dir> [--category <id>]');
    console.error('  或: ingest.ts [--fake] --out <learning dir> [--category <id>] [--topic <文字>]');
    process.exit(1);
  }

  if (!filePath) {
    await runScanCli({ useFake, outDir, ...(categoryArg !== undefined ? { category: categoryArg } : {}), ...(topic !== undefined ? { topic } : {}) });
    return;
  }

  const category = categoryArg ?? 'security';

  // T6(契約 1.4.0 §1、ADR-067):分類名是 raw/<分類>、cards/<分類> 的路徑段,必須在
  // ensureInitialized 之前驗——拒絕時輸出目錄前後相等,連骨架都不建。印一行(帶使用者給的值
  // 與 rule 名),不丟 stack trace;與 runIngest、setCategory、schema 同一份 validateCategoryId。
  const verdict = validateCategoryId(category);
  if (!verdict.ok) {
    console.error(`${formatCategoryIdRefusal(category, verdict.rule)};沒有建立任何檔案或資料夾`);
    process.exit(1);
  }

  const absOut = resolve(outDir);
  ensureInitialized(absOut);
  const existingCategory = listCategories(absOut).find((c) => c.id === category);
  if (!existingCategory) {
    setCategory(absOut, { id: category, name: category, require_raw: true });
    console.log(`新建分類 ${category}(require_raw: true)`);
  }

  const srcAbs = resolve(filePath);
  if (!existsSync(srcAbs)) {
    console.error(`找不到檔案:${filePath}`);
    process.exit(1);
  }

  const base = basename(srcAbs);
  const rawRelPath = `raw/${category}/${base}`;
  const rawAbs = join(absOut, rawRelPath);
  const destKind = rawDestKind(rawAbs);
  if (destKind === 'other') {
    console.error(`拒絕覆寫:${rawRelPath} 已存在且不是一般檔案`);
    process.exit(1);
  }
  if (destKind === 'file') {
    if (!sameFileBytes(srcAbs, rawAbs)) {
      console.error(`拒絕覆寫:${rawRelPath} 已存在且內容不同`);
      process.exit(1);
    }
    // 內容相同:不複製,mtime 不變。
  } else {
    mkdirSync(dirname(rawAbs), { recursive: true });
    copyFileSync(srcAbs, rawAbs);
  }

  if (useFake) {
    const fixturesDir = join(ROOT, 'contracts/fixtures/llm');
    const router = new FakeLlmRouter({ fixturesDir });
    const result = await runIngest({ outDir: absOut, rawRelPath, category, router });

    console.log(result.message);
    for (const id of result.cardsCreated) console.log(`  ${id}`);
    process.exit(result.exitCode);
  }

  const router = new LlmRouterImpl({
    settings: readLlmSettings(absOut),
    logPath: join(absOut, 'state/log.jsonl'),
  });

  const online = await router.probeOnline();
  if (!online) {
    console.error('ingest requires a cloud model,目前偵測不到可用的雲端模型,不會降級到本機模型。');
    process.exit(1);
  }

  const result = await runIngestPipeline({ outDir: absOut, rawRelPath, category, router });

  // 建立的卡 = level 0 卡 + 子卡。只印 level 0 的話,子卡就成了看不見的產物——
  // 這個總數現在就是 runIngestPipeline() 的 message 本人,CLI 不再另外算一個
  // 表頭數字,免得兩個數字背靠背互相矛盾(features/02-ingest-pipeline/REVIEW.md §7.6 第 1 點)。
  console.log(result.message);
  for (const id of [...result.cardsCreated, ...result.childrenCreated]) console.log(`  ${id}`);

  // I1 的 e2e 場景「every card has a question file with the same id」不接受部分
  // 成功:只要有任何一張卡的考題產生失敗,整個 CLI 就以非 0 退出碼結束。
  if (result.hasQuestionFailures) {
    const failures = [...result.questionFailures, ...result.childQuestionFailures];
    console.error(`${failures.length} 張卡的考題產生失敗:`);
    for (const f of failures) console.error(`  ${f.card} — ${f.error}`);
    console.error('每張卡都必須有考題檔,部分成功不算完成。');
    process.exit(1);
  }

  process.exit(result.exitCode);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
