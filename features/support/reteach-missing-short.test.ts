/**
 * T25(終端機層):連錯兩次的卡沒有縮短版時,真的 scripts/review.ts 不中止,先印原卡與提示,再問題目。
 * 跑真的子程序(量尺 review-session-harness.ts),暫存目錄,不碰真的 learning/。
 *
 * 單元層(presentNextCard 的回傳、warning 的形狀與容錯)在 packages/core/src/session/present-reteach-fallback.test.ts。
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseCardText } from '@core/schema/parse-card.js';
import { TODAY, createVault, ledgerEvents, removeVault, reviewRecord, runReview, writeReviews, type Vault } from './review-session-harness.js';

const HEADING = '[複習提示,先看過再回答問題]';
const vaults: Vault[] = [];
afterAll(() => {
  for (const v of vaults) removeVault(v);
});

function twiceFailedVault(): Vault {
  const v = createVault({ cards: 3 });
  vaults.push(v);
  writeReviews(v, { 'sec-0001': reviewRecord({ next_due: TODAY, fails_in_row: 2, total_fails: 2 }) });
  return v;
}

const originalBody = (v: Vault): string => parseCardText(readFileSync(join(v.dir, 'cards/security/sec-0001.md'), 'utf8')).body;
const warnings = (v: Vault) => ledgerEvents(v).filter((e) => e.type === 'warning' && e.reason === 'short-card-missing');

describe('終端機:沒有縮短版', () => {
  it(
    '不中止、退出碼 0;標題行加「(沒有縮短版,以下是原卡)」;之後印原卡 body;再問該卡第 1/1 題;小結照印;剛好一筆 warning',
    async () => {
      const v = twiceFailedVault();
      const out = await runReview(v, { answers: 'all' });
      expect(out.status, out.output).toBe(0);
      expect(out.output).not.toMatch(/找不到卡片檔案/);
      const heading = `${HEADING} sec-0001(沒有縮短版,以下是原卡)`;
      const at = out.stdout.indexOf(heading);
      expect(at, out.stdout).toBeGreaterThanOrEqual(0);
      const body = originalBody(v);
      const bodyAt = out.stdout.indexOf(body, at);
      expect(bodyAt).toBeGreaterThan(at);
      expect(out.stdout).not.toContain('```example');
      expect(out.stdout).not.toContain('source_ref');
      expect(out.asked).toEqual([{ index: 1, total: 1, card: 'sec-0001' }]);
      expect(bodyAt).toBeLessThan(out.stdout.indexOf('(1/1)'));
      expect(out.stdout).toMatch(/1 passed, 0 returned\./);
      const found = warnings(v);
      expect(found).toHaveLength(1);
      expect(found[0]!.card).toBe('sec-0001');
      expect(JSON.stringify(found[0])).not.toContain(v.scratch);
    },
    180_000,
  );

  it(
    '原卡也不存在時照舊中止(卡不存在是磁碟壞掉的徵兆):退出碼 1、有訊息、沒有 short-card-missing 的 warning',
    async () => {
      const v = twiceFailedVault();
      rmSync(join(v.dir, 'cards/security/sec-0001.md'));
      const out = await runReview(v, { answers: 'all' });
      expect(out.status, out.output).toBe(1);
      expect(out.output).toMatch(/sec-0001/);
      expect(warnings(v)).toEqual([]);
    },
    180_000,
  );
});

describe('終端機:有縮短版(輸出與現況逐字相同)', () => {
  it(
    '標題行沒有提示、印縮短版內容、沒有 warning、沒有 log 檔',
    async () => {
      const v = twiceFailedVault();
      writeFileSync(
        join(v.dir, 'cards/security/sec-0001.short.md'),
        '---\nid: sec-0001\ncategory: security\ntitle: 同源政策\nlevel: 0\nsource: raw\ncreated: 2026-09-01\n---\n縮短版內容標記T25。\n',
        'utf8',
      );
      const out = await runReview(v, { answers: 'all' });
      expect(out.status, out.output).toBe(0);
      expect(out.stdout).toContain(`\n${HEADING} sec-0001\n縮短版內容標記T25。\n`);
      expect(out.stdout).not.toMatch(/沒有縮短版/);
      expect(out.asked).toEqual([{ index: 1, total: 1, card: 'sec-0001' }]);
      expect(warnings(v)).toEqual([]);
    },
    180_000,
  );
});
