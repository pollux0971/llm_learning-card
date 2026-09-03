/**
 * 11-review-cli / phase-1:對 learning/ 目錄的讀寫邊界。
 *
 * 這裡集中放「碰磁碟」的部分,讓 build.ts / present.ts / answer.ts 的邏輯
 * 不用重複處理路徑組合與檔案格式。全部函式本體先 throw not implemented,
 * 邏輯留給下一輪開發 agent,但每個函式的預期行為寫在下面。
 *
 * 讀 reviews.json / questions/*.yaml / config/settings.yaml 一律用
 * @contracts 的 zod schema 驗證,不重新發明——這是 01-data-layer 已經做好的
 * 權威格式檢查。寫 reviews.json 用 01 的 writeFileAtomic
 * (硬規則 5:tmp → fsync → rename)。實作時會用到:
 *   node:fs 的 readFileSync / readdirSync / existsSync、node:path 的 join、
 *   yaml 的 parse、@contracts 的 ReviewSchema / QuestionFileSchema /
 *   SettingsSchema、@core/schema/atomic-write.js 的 writeFileAtomic。
 */
import type { CardId, QuestionFile, Review, Settings } from '@contracts/index.js';

/**
 * state/reviews.json 讀成 Record<CardId, Review>。每筆值過
 * `ReviewSchema.parse`,格式錯誤時讓 zod 的錯誤直接往上丟(這是磁碟壞掉的
 * 徵兆,不該吞掉)。檔案不存在視為 `{}`(還沒有任何複習記錄)。
 */
export function loadReviews(_learningDir: string): Record<CardId, Review> {
  throw new Error('not implemented');
}

/**
 * 整份覆寫 state/reviews.json(呼叫端保證傳進來的是最新的完整物件)。
 * 用 `writeFileAtomic`,不是普通的 writeFileSync——這是「幾個月的記憶資料」,
 * 見契約 §11b、CLAUDE.md 硬規則 5。
 */
export function saveReviews(_learningDir: string, _reviews: Record<CardId, Review>): void {
  throw new Error('not implemented');
}

/** config/settings.yaml,用 `SettingsSchema.parse` 驗證。phase-1 只用得到 daily_cap。 */
export function loadSettings(_learningDir: string): Settings {
  throw new Error('not implemented');
}

/** questions/<id>.yaml,用 `QuestionFileSchema.parse` 驗證與套預設值。 */
export function loadQuestionFile(_learningDir: string, _card: CardId): QuestionFile {
  throw new Error('not implemented');
}

/**
 * 在 cards/*&#47; 底下找一張卡的檔案路徑。`opts.short` 為 true 找
 * `<id>.short.md`,否則找 `<id>.md`。找不到就丟錯——呼叫端不該對不存在的
 * 卡或不存在的縮短版發問。
 *
 * CardId 本身不含 category(reviews.json 裡沒有存這個欄位),只能掃
 * `cards/` 底下每個分類子目錄找檔名——phase-1 的規模(單一 session,最多
 * daily_cap 張)掃全部分類目錄夠快,不需要建索引。
 */
export function findCardFile(_learningDir: string, _card: CardId, _opts: { short?: boolean } = {}): string {
  throw new Error('not implemented');
}

/**
 * 讀一張卡(或縮短版)的 body 文字——不含 frontmatter、不含 example 圍欄
 * (用 `parseCardText` 的 `.body`)。reteach 呈現(「shown before the first
 * question」)與一般問答呈現都走這個函式,差別只在 `opts.short`。
 */
export function loadCardBody(_learningDir: string, _card: CardId, _opts: { short?: boolean } = {}): string {
  throw new Error('not implemented');
}
