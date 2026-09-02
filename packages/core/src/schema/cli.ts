#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { validateCard } from './validate-card.js';
import { initLearningDir } from './init.js';

function usage(): never {
  console.error('用法:');
  console.error('  cli.ts validate <card.md>');
  console.error('  cli.ts init <dir>');
  process.exit(2);
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

const [, , cmd, arg] = process.argv;

switch (cmd) {
  case 'validate':
    runValidate(arg);
    break;
  case 'init':
    runInit(arg);
    break;
  default:
    usage();
}
