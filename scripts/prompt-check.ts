/**
 * CLI 入口(features/12-prompt-quality)。邏輯本體在
 * packages/core/src/prompt-quality/cli.ts,這裡只負責印輸出、設退出碼。
 *
 * 用法:
 *   npx tsx scripts/prompt-check.ts --golden [--task <task>] [--fake] [--out <存放根目錄>]
 *   npx tsx scripts/prompt-check.ts --diff <run 目錄 A> <run 目錄 B>
 *
 * ADR-034:.env 只在 CLI 入口載入(這裡漏了——2026-09-12 實測 `--live` 因此讀不到
 * `.env` 的 LLM_CLOUD_PROVIDER/OPENAI_API_KEY,整個落回 config/settings.yaml 的
 * anthropic 設定再丟 MissingCredentialError)。跟 scripts/llm.ts / ingest.ts /
 * llm-spend.ts 同一套 side-effect import。
 */
import './_env.js';
import { main } from '../packages/core/src/prompt-quality/cli.js';

const result = await main(process.argv.slice(2));
console.log(result.output);
process.exit(result.code);
