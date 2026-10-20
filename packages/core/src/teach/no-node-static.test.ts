/**
 * T37(ADR-077 B-lite):`packages/core/src/teach/` 是純函式,底下(非測試)的檔案不准 import 任何 node: 內建模組。
 * 測試 agent 寫;開發 worker 不改。
 *
 * 為什麼自己寫:`npm run boundaries` 把 node: 模組當外部,抓不到。讀 order 檔(碰 fs)的函式在 `schema/graph.ts`。
 * 範圍是 teach/ 底下**不是測試**的檔(`*.test.ts` 自己要用 fs 建暫存目錄)。
 * 抓法:去掉註解之後,看 import / export … from / 動態 import() / require() 的指定字串:`node:` 開頭,
 * 或是不帶 `node:` 的內建模組名(`fs`、`path`、`fs/promises`……)。
 */
import { builtinModules } from 'node:module';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const TEACH = import.meta.dirname;
const ROOT = join(TEACH, '../../../..');
const BUILTINS = new Set(builtinModules.map((m) => m.replace(/^node:/, '')));

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (_m, pre: string) => pre);
}

/** 檔案裡所有 import 的指定字串 */
export function importSpecs(src: string): string[] {
  const body = stripComments(src);
  const specs: string[] = [];
  const patterns = [
    /\bimport\s+(?:type\s+)?[^'";]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bexport\s+(?:type\s+)?[^'";]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) for (const m of body.matchAll(re)) if (m[1]) specs.push(m[1]);
  return specs;
}

export function isNodeSpec(spec: string): boolean {
  if (spec.startsWith('node:')) return true;
  const head = spec.split('/')[0] ?? spec;
  return BUILTINS.has(spec) || BUILTINS.has(head);
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

describe('teach/ 底下(非測試)的檔案不 import node: 內建模組', () => {
  it('量尺自測:各種寫法都抓得到,註解與一般套件抓不到', () => {
    const bad = [
      "import { readFileSync } from 'node:fs';",
      'import { join } from "node:path";',
      "import fs from 'fs';",
      "import { readFile } from 'fs/promises';",
      "export { join } from 'path';",
      "const m = await import('node:os');",
      "const r = require('fs');",
      "import type { Stats } from 'node:fs';",
    ];
    for (const line of bad) {
      const specs = importSpecs(line);
      expect(specs.length, line).toBe(1);
      expect(isNodeSpec(specs[0]!), line).toBe(true);
    }
    const fine = [
      "import { z } from 'zod';",
      "import { orderDeck } from './deck.js';",
      "// import { readFileSync } from 'node:fs';",
      "/* import fs from 'fs'; */",
      "import { x } from './fsutil.js';",
    ];
    for (const line of fine) expect(importSpecs(line).some(isNodeSpec), line).toBe(false);
  });

  it('teach/ 底下至少有一個非測試的檔(量尺:沒有檔就沒東西可量)', () => {
    expect(files().length).toBeGreaterThan(0);
  });

  it('沒有任何一個 import 是 node: 模組或內建模組名', () => {
    const bad: string[] = [];
    for (const f of files()) {
      for (const spec of importSpecs(readFileSync(f, 'utf8'))) {
        if (isNodeSpec(spec)) bad.push(`${relative(ROOT, f)} import '${spec}'`);
      }
    }
    expect(bad, 'teach/ 是純函式(ADR-077 B-lite);碰檔案的在 session/teach.ts,讀 order 檔的在 schema/graph.ts').toEqual([]);
  });
});

function files(): string[] {
  if (!existsSync(TEACH)) return [];
  return walk(TEACH).filter((f) => /\.(ts|js|mjs|svelte)$/.test(f) && !/\.test\.ts$/.test(f));
}
