/**
 * T25 驗收補測(驗收者寫):紅測試只把原卡與縮短版放在同一個分類資料夾,沒量到「縮短版在別的分類」與「根本沒有 cards/ 目錄」。
 * 缺口(驗收時各做一個改壞版本,紅測試全綠):shortCardExists 只查第一個分類;沒有 cards/ 時它自己丟 ENOENT 而不是讓
 * loadCardBody 丟「找不到卡片檔案」。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { LlmRouter } from '@core/grading/index.js';
import { presentNextCard } from './present.js';
import type { Session } from './types.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const router: LlmRouter = {
  async call() {
    throw new Error('不該呼叫 router');
  },
  async probeOnline() {
    return true;
  },
  async probeLocal() {
    return { available: false, models: [] };
  },
};

function session(dir: string): Session {
  return { learningDir: dir, today: '2026-09-10', dailyCap: 10, router, queue: [], reteachQueue: ['sec-0001'], totalDue: 0, deferred: 0, passed: 0, failed: 0, errors: 0 };
}

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'lc-t25acc-'));
  mkdirSync(join(d, 'state'), { recursive: true });
  dirs.push(d);
  return d;
}

describe('縮短版與原卡在不同分類資料夾', () => {
  it('原卡在排前面的分類、縮短版在排後面的分類 → 仍用縮短版,不退回、不記 warning', async () => {
    const dir = tmp();
    mkdirSync(join(dir, 'cards/aaa-first'), { recursive: true });
    mkdirSync(join(dir, 'cards/zzz-last'), { recursive: true });
    writeFileSync(join(dir, 'cards/aaa-first/sec-0001.md'), '---\nid: sec-0001\ncategory: aaa-first\ntitle: t\nlevel: 0\nsource: raw\nsource_ref: raw/aaa/x.md#L1-L2\ncreated: 2026-09-01\n---\n原卡內容。\n');
    writeFileSync(join(dir, 'cards/zzz-last/sec-0001.short.md'), '---\nid: sec-0001\ncategory: zzz-last\ntitle: t\nlevel: 0\nsource: raw\ncreated: 2026-09-01\n---\n縮短版內容。\n');
    expect(await presentNextCard(session(dir))).toEqual({ kind: 'reteach', card: 'sec-0001', shortBody: '縮短版內容。' });
  });
});

describe('沒有 cards/ 目錄', () => {
  it('丟「找不到卡片檔案」(卡不存在是磁碟壞掉的徵兆),不是別的錯,也不記 warning', async () => {
    const dir = tmp();
    await expect(presentNextCard(session(dir))).rejects.toThrow(/找不到卡片檔案.*sec-0001/);
  });
});
