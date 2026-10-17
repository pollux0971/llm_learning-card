/**
 * T24 must_catch「登記表不准腐爛」(顧問裁決 B1):`scripts/degraded-report.ts` 的 NOT_INSTRUMENTED 每一筆,
 * file 都要存在、snippet 都要找得到。跟零輸入守門鎖 2 同形,但直接讀真 repo 的那張表。
 *
 * 不改 degraded-report.ts 的行為。基底上綠;worker 刪了 apps/test-card/src/stubs/ 或改寫 session.ts
 * 卻沒把指向它們的登記一起刪,這條就紅。紅測試作者寫;開發 worker 不改。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NOT_INSTRUMENTED } from '../../scripts/degraded-report.js';

const ROOT = join(import.meta.dirname, '../..');

describe('NOT_INSTRUMENTED 登記表不准腐爛', () => {
  it('表不是空的(掃到 0 筆不算過)', () => {
    expect(NOT_INSTRUMENTED.length).toBeGreaterThan(0);
  });

  it('每一筆的檔案都存在', () => {
    const missing = NOT_INSTRUMENTED.filter((item) => !existsSync(join(ROOT, item.file))).map((item) => `${item.file}(檔案不存在)`);
    expect(missing, '登記指向不存在的檔,請在同一個 commit 刪掉那筆登記').toEqual([]);
  });

  it('每一筆的 snippet 都還在那個檔裡', () => {
    const gone = NOT_INSTRUMENTED.filter((item) => {
      const full = join(ROOT, item.file);
      return existsSync(full) && !readFileSync(full, 'utf8').split('\n').some((l) => l.includes(item.snippet));
    }).map((item) => `${item.file}:片段已搬走 \`${item.snippet}\``);
    expect(gone, '登記的片段找不到了,請同一個 commit 更新或刪掉那筆登記').toEqual([]);
  });
});
