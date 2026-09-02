/**
 * CLI 入口(features/12-prompt-quality)。邏輯本體在
 * packages/core/src/prompt-quality/cli.ts,這裡只負責印輸出、設退出碼。
 *
 * 用法:
 *   npx tsx scripts/prompt-check.ts --golden [--task <task>] [--fake]
 *   npx tsx scripts/prompt-check.ts --diff <run 目錄 A> <run 目錄 B>
 */
import { main } from '../packages/core/src/prompt-quality/cli.js';

const result = await main(process.argv.slice(2));
console.log(result.output);
process.exit(result.code);
