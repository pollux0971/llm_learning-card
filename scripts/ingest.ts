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
import { mkdirSync, copyFileSync, existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { parse as yamlParse } from 'yaml';
import { FakeLlmRouter } from '../packages/core/src/ingest/fake-llm.js';
import { runIngest, runIngestPipeline } from '../packages/core/src/ingest/ingest.js';
import { ensureInitialized, setCategory } from '../packages/core/src/ingest/init.js';
import { LlmRouterImpl, type RouterSettings } from '../packages/core/src/llm/router-impl.js';

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

async function main(): Promise<void> {
  const useFake = process.argv.includes('--fake');
  const filePath = arg('--file');
  const outDir = arg('--out');
  const category = arg('--category') ?? 'security';

  if (!filePath || !outDir) {
    console.error('用法: ingest.ts [--fake] --file <raw file> --out <learning dir> [--category <id>]');
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
  // 表頭數字,免得兩個數字背靠背互相矛盾(REVIEW.md §7.6 第 1 點)。
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
