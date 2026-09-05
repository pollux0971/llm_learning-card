#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse as yamlParse } from 'yaml';
import { validateCard } from './validate-card.js';
import { initLearningDir } from './init.js';
import { initGitRepo } from './git-repo.js';
import { validateQuestionFile, findCardsMissingQuestions, listCardIds } from './validate-question.js';
import { validateReview } from './review.js';
import { validateLogEvent } from './log.js';
import { validateCategory, validateSettings } from './validate-config.js';
import type { ValidationResult } from './log.js';

function usage(): never {
  console.error('用法:');
  console.error('  cli.ts validate <card.md>');
  console.error('  cli.ts init <dir>');
  console.error('  cli.ts validate-question <questions/xxx.yaml>');
  console.error('  cli.ts validate-review <state/reviews.json>');
  console.error('  cli.ts validate-log <state/log.jsonl>');
  console.error('  cli.ts validate-category <config/categories.yaml>');
  console.error('  cli.ts validate-settings <config/settings.yaml>');
  console.error('  cli.ts check-questions <learning-dir>');
  process.exit(2);
}

function reportResult(result: ValidationResult): never {
  if (result.ok) {
    console.log('OK');
    process.exit(0);
  }
  console.log('FAIL');
  for (const err of result.errors) console.log(`  - ${err}`);
  process.exit(1);
}

function runValidate(file: string | undefined): void {
  if (!file) usage();
  const raw = readFileSync(file, 'utf8');
  const result = validateCard(raw);
  if (result.ok) {
    console.log(`OK ${result.bodyWordCount}`);
    process.exit(0);
  }
  console.log('FAIL');
  for (const err of result.errors) console.log(`  - ${err}`);
  process.exit(1);
}

function runInit(dir: string | undefined): void {
  if (!dir) usage();
  const result = initLearningDir(dir);
  for (const p of result.created) console.log(`created  ${p}`);
  for (const p of result.skipped) console.log(`skipped  ${p} (already exists)`);
  // ADR-042:目錄樹建完之後把 learning/ 變成它自己的 git repo(契約 §11b)。
  // 冪等,而且找不到 git 只印 warning——§11b 說的是「建議」,不能拿它擋掉整個產品。
  const git = initGitRepo(dir);
  if (git.warning) console.warn(git.warning);
  else if (git.status === 'created') console.log('created  .gitignore\ncreated  git repo (commit: init)');
  else console.log('skipped  git repo (already a repo)');
  process.exit(0);
}

function runValidateQuestion(file: string | undefined): void {
  if (!file) usage();
  const raw = yamlParse(readFileSync(file, 'utf8'));
  reportResult(validateQuestionFile(raw));
}

function runValidateReview(file: string | undefined): void {
  if (!file) usage();
  const reviews = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  const errors: string[] = [];
  for (const [id, review] of Object.entries(reviews)) {
    const r = validateReview(review);
    for (const e of r.errors) errors.push(`${id}.${e}`);
  }
  reportResult({ ok: errors.length === 0, errors });
}

function runValidateLog(file: string | undefined): void {
  if (!file) usage();
  const lines = readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const errors: string[] = [];
  lines.forEach((line, i) => {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      errors.push(`line ${i + 1}: not valid JSON`);
      return;
    }
    const r = validateLogEvent(event);
    for (const e of r.errors) errors.push(`line ${i + 1}.${e}`);
  });
  reportResult({ ok: errors.length === 0, errors });
}

function runValidateCategory(file: string | undefined): void {
  if (!file) usage();
  const categories = yamlParse(readFileSync(file, 'utf8')) as unknown[];
  const errors: string[] = [];
  categories.forEach((c, i) => {
    const r = validateCategory(c);
    for (const e of r.errors) errors.push(`${i}.${e}`);
  });
  reportResult({ ok: errors.length === 0, errors });
}

function runValidateSettings(file: string | undefined): void {
  if (!file) usage();
  const settings = yamlParse(readFileSync(file, 'utf8'));
  reportResult(validateSettings(settings));
}

/**
 * `check-questions <learning-dir>` —— **三種 0 要分得出來**。
 *
 * 修之前:`findCardsMissingQuestions()` 在 `cards/` 不存在時回 `[]`,而這裡只看
 * 「陣列是不是空的」,於是一個**根本不存在的路徑**印出 `OK` + exit 0。
 * 「沒有東西缺考題」跟「我沒有檢查任何東西」變成同一個答案。
 *
 * 現在的形狀跟 boundaries 那句「掃描 195 個檔案,允許例外 11 條」同一套:
 * 先印**檢查了幾張卡**(OK 後面沒有數字就不知道那個 OK 有多少份量),
 * 再讓三種 0 各自有一句話。
 *
 * 退出碼:
 *   0  真的檢查過 N ≥ 1 張卡,全部都有 questions/
 *   1  檢查過 N ≥ 1 張卡,其中有缺的(既有行為,不動)
 *   2  **沒東西可檢查**——目錄不在、沒有 cards/、或 cards/ 底下 0 張卡
 *
 * 2 而不是 0:對呼叫的人來說「我沒檢查」跟「我檢查完沒問題」是兩件事,跟
 * 「我檢查出問題」也是兩件事。cli.ts 本來就用 2 表示「這次沒有做成檢查」
 * (見 usage()),這裡是同一個意思的延伸。剛 init 完的空 vault 會落在 2,
 * 那是誠實的答案——它確實沒有卡片可以檢查。
 */
function runCheckQuestions(dir: string | undefined): void {
  if (!dir) usage();

  if (!existsSync(dir)) {
    console.error(`✗ check-questions: learning 目錄不存在:${dir}`);
    console.error('沒有檢查任何東西——這不是「都有考題」,是「找不到要檢查的東西」。');
    process.exit(2);
  }
  if (!statSync(dir).isDirectory()) {
    console.error(`✗ check-questions: 指到的不是目錄,是一個檔案:${dir}`);
    process.exit(2);
  }

  const cardsDir = join(dir, 'cards');
  if (!existsSync(cardsDir)) {
    console.error(`✗ check-questions: ${dir} 底下沒有 cards/ 目錄`);
    console.error('沒有檢查任何東西——先用 cli.ts init 建目錄樹,或確認路徑指對了。');
    process.exit(2);
  }

  const cards = listCardIds(dir);
  if (cards.length === 0) {
    console.error(`✗ check-questions: 檢查了 0 張卡 —— ${cardsDir} 底下一張卡片都沒有`);
    console.error('目錄樹是完整的,只是沒有內容。空的 vault 不算「全部都有考題」。');
    process.exit(2);
  }

  const missing = findCardsMissingQuestions(dir);
  if (missing.length === 0) {
    console.log(`OK 檢查了 ${cards.length} 張卡,全部都有 questions/`);
    process.exit(0);
  }
  console.log(`FAIL 檢查了 ${cards.length} 張卡,其中 ${missing.length} 張缺考題`);
  for (const id of missing) console.log(`  - missing questions/${id}.yaml`);
  process.exit(1);
}

const [, , cmd, arg] = process.argv;

switch (cmd) {
  case 'validate':
    runValidate(arg);
    break;
  case 'init':
    runInit(arg);
    break;
  case 'validate-question':
    runValidateQuestion(arg);
    break;
  case 'validate-review':
    runValidateReview(arg);
    break;
  case 'validate-log':
    runValidateLog(arg);
    break;
  case 'validate-category':
    runValidateCategory(arg);
    break;
  case 'validate-settings':
    runValidateSettings(arg);
    break;
  case 'check-questions':
    runCheckQuestions(arg);
    break;
  default:
    usage();
}
