/**
 * T17 驗收補測(驗收者寫):紅測試沒有量到的一條 —— 續答時 reteach 名單要照快取。
 *
 * 缺口:把 sessionFromCache 的 `reteachQueue: [...cache.reteach]` 改成 `[]`,紅測試全綠。
 * 快取存 reteach(工單「快取格式」)就是為了「同一天再跑,題目集合、順序、reteach 都用第一次建好的那一份」。
 * 這裡手寫一份帶 reteach 的快取(格式是工單規格),跑真的 scripts/review.ts,要看到複習提示(縮短版)出現在第一題之前。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { TODAY, cachePath, createVault, removeVault, runReview, seedDue, type Vault } from './review-session-harness.js';

const vaults: Vault[] = [];
afterAll(() => {
  for (const v of vaults) removeVault(v);
});

describe('續答時 reteach 照快取', () => {
  it(
    '快取的 reteach 有 sec-0002 → 續答時先印它的複習提示(縮短版),再問第一題;reteach 為空的快取不印',
    async () => {
      const v = createVault({ cards: 4 });
      vaults.push(v);
      seedDue(v, ['sec-0001', 'sec-0002'], [4, 3]);
      writeFileSync(
        join(v.dir, 'cards/security/sec-0002.short.md'),
        '---\nid: sec-0002\ncategory: security\ntitle: 同源政策\nlevel: 0\nsource: raw\ncreated: 2026-09-01\n---\n縮短版內容標記RETEACHMARK。\n',
        'utf8',
      );
      const queue = [
        { card: 'sec-0001', stage: 1, overdue_days: 4, overdue_ratio: 4 },
        { card: 'sec-0002', stage: 1, overdue_days: 3, overdue_ratio: 3 },
      ];
      const write = (reteach: string[]): void => {
        const path = cachePath(v);
        mkdirSync(join(path, '..'), { recursive: true });
        writeFileSync(path, `${JSON.stringify({ version: 1, date: TODAY, paused: false, total_due: 2, deferred: 0, queue, reteach }, null, 2)}\n`, 'utf8');
      };

      write(['sec-0002']);
      const withHint = await runReview(v, { answers: 0 });
      const hintAt = withHint.stdout.indexOf('RETEACHMARK');
      expect(hintAt, `續答時沒有印複習提示:\n${withHint.output}`).toBeGreaterThanOrEqual(0);
      expect(hintAt).toBeLessThan(withHint.stdout.indexOf('(1/2)'));

      write([]);
      const without = await runReview(v, { answers: 0 });
      expect(without.stdout).not.toContain('RETEACHMARK');
      expect(without.asked[0]).toEqual({ index: 1, total: 2, card: 'sec-0001' });
    },
    180_000,
  );
});
