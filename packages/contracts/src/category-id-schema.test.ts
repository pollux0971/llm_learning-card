/**
 * T6:契約這一側的 CategoryIdSchema(zod)也要擋不合法的 CategoryId(契約 1.4.0 §1)。
 * 只在 core 擋的話,@contracts 這份 schema 會比契約寬,又變成兩份不一致(顧問 2026-10-15)。
 * 作者:測試 agent。開發 worker 不改。
 */
import { CategoryIdSchema, CategorySchema, CardFrontmatterSchema } from './index.js';

const BAD = ['C++', '\u1100\u1161', '\uf900', 'e\u0301', 'a.', '.hidden', 'nul', 'COM9', 'COM\u00b9', '\uac00'.repeat(21) + 'ab', ''];
const GOOD = ['security', 'Security', 'a.b-c_d9', '\u30bb\u30ad\u30e5\u30ea\u30c6\u30a3\u30fc', '\uac00'.repeat(21) + 'a'];

describe('CategoryIdSchema 依 §1 收窄', () => {
  it.each(BAD)('拒絕 %j', (value) => {
    expect(CategoryIdSchema.safeParse(value).success).toBe(false);
  });
  it.each(GOOD)('放行 %j', (value) => {
    expect(CategoryIdSchema.safeParse(value).success).toBe(true);
  });
  it('CategorySchema.id 與 CardFrontmatterSchema.category 都用同一個規則', () => {
    expect(CategorySchema.safeParse({ id: 'C++', name: 'x', require_raw: false }).success).toBe(false);
    expect(
      CardFrontmatterSchema.safeParse({
        id: 'sec-0001', category: 'C++', title: 't', level: 0, source: 'llm', created: '2026-09-01',
      }).success,
    ).toBe(false);
  });
});
