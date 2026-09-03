#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parse as yamlParse } from 'yaml';
import { validateCard } from './validate-card.js';
import { initLearningDir } from './init.js';
import { validateQuestionFile, findCardsMissingQuestions } from './validate-question.js';
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

function runCheckQuestions(dir: string | undefined): void {
  if (!dir) usage();
  const missing = findCardsMissingQuestions(dir);
  if (missing.length === 0) {
    console.log('OK');
    process.exit(0);
  }
  console.log('FAIL');
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
