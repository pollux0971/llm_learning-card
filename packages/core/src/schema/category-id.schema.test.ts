/**
 * T6:zod schema 兩處(卡片 frontmatter 的 category、categories.yaml 的 id)都擋不合法的 CategoryId,
 * 錯誤訊息含 rule 名。兩處各有自己的測試——缺一處,must_catch 的「只擋一邊」就沒人抓。
 * 作者:測試 agent。開發 worker 不改。
 *
 * 走 validateCard / validateCategory(公開入口),不指定 zod 的實作放在哪個檔;
 * 契約這一側的 CategoryIdSchema 另在 packages/contracts/src/category-id-schema.test.ts 測。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateCard } from './validate-card.js';
import { validateCategory } from './validate-config.js';

const MINIMAL_CARD = fileURLToPath(
  new URL('../../../../contracts/fixtures/learning-minimal/cards/security/sec-0001.md', import.meta.url),
);

function cardWithCategory(category: string): string {
  const raw = readFileSync(MINIMAL_CARD, 'utf8');
  expect(raw).toContain('category: security\n'); // 基準:取代的目標真的在
  return raw.replace('category: security\n', `category: ${category}\n`);
}

// [分類名, rule]。分解形式與特殊碼位一律用 \u 跳脫寫成真碼位。
const BAD: Array<[string, string]> = [
  ['C++', 'charset'],
  ['"\u1100\u1161"', 'nfc'],
  ['"\uf900"', 'nfc'],
  ['"e\u0301"', 'nfc'],
  ['"a."', 'trailing-dot'],
  ['".hidden"', 'leading-dot'],
  ['nul', 'reserved'],
  ['COM9', 'reserved'],
  ['"COM\u00b9"', 'reserved'],
];

// YAML 的雙引號字串會把 \u 還原成真碼位,所以 yaml 文字裡寫跳脫、測試裡比對的是還原後的值。
describe('卡片 frontmatter 的 category', () => {
  it.each(BAD)('拒絕 %s,錯誤訊息含 rule 名 %s', (category, rule) => {
    const result = validateCard(cardWithCategory(category));
    expect(result.ok).toBe(false);
    expect(result.errors.filter((e) => e.startsWith('category')).join('\n')).toContain(rule);
  });

  it('拒絕 65 位元組的分類名,訊息含 length', () => {
    const result = validateCard(cardWithCategory('"' + '\uac00'.repeat(21) + 'ab"'));
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('length');
  });

  it('正向對照:security、Security、セキュリティー 照常通過', () => {
    for (const ok of ['security', 'Security', '"\u30bb\u30ad\u30e5\u30ea\u30c6\u30a3\u30fc"']) {
      const result = validateCard(cardWithCategory(ok));
      expect(result.errors.filter((e) => e.startsWith('category'))).toEqual([]);
    }
  });
});

describe('config/categories.yaml 的 id', () => {
  const entry = (id: string) => ({ id, name: 'x', require_raw: false });
  const decode = (yamlQuoted: string): string =>
    yamlQuoted.startsWith('"') ? (JSON.parse(yamlQuoted) as string) : yamlQuoted;

  it.each(BAD)('拒絕 %s,錯誤訊息含 rule 名 %s', (category, rule) => {
    const result = validateCategory(entry(decode(category)));
    expect(result.ok).toBe(false);
    expect(result.errors.filter((e) => e.startsWith('id')).join('\n')).toContain(rule);
  });

  it('拒絕 65 位元組的分類名,訊息含 length', () => {
    const result = validateCategory(entry('\uac00'.repeat(21) + 'ab'));
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('length');
  });

  it('正向對照:security、Security、セキュリティー 照常通過', () => {
    for (const ok of ['security', 'Security', '\u30bb\u30ad\u30e5\u30ea\u30c6\u30a3\u30fc']) {
      expect(validateCategory(entry(ok)).ok).toBe(true);
    }
  });
});
