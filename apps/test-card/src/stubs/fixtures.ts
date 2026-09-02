/**
 * Wave 0 的「rich fixture set」。
 *
 * 內容逐字複製自 `contracts/fixtures/learning-minimal/questions/*.yaml`(見該目錄的
 * README:三張真的資安卡、三份考題),配上這裡自己編的 state/reviews.json,
 * 讓三張卡今天都到期,涵蓋 stage 1(只考填空)、stage 2(填空+應用)、
 * stage 3(只考應用)三種題型組合。
 *
 * 不直接 import contracts/fixtures 底下的檔案,是刻意的:phase-1 要能在
 * 01/04 都還沒做完時獨立運作(FEATURE.md「Wave 0 的依賴:無」)。
 * 未來 04-scheduler 完成後,I3 把這個檔案整個刪掉、換成真的 select()。
 */
export const TODAY = '2026-09-10';

export const QUESTIONS_YAML: Record<string, string> = {
  'questions/sec-0001.yaml': `card: sec-0001
fill:
  - prompt: "同源的判定條件是 ___、___、___ 三者相同。"
    answers:
      - ["協定", "protocol", "scheme"]
      - ["主機", "host", "網域", "domain"]
      - ["埠號", "port", "埠"]
  - prompt: "https://a.com 和 http://a.com 是否同源?___"
    answers:
      - ["否", "不同源", "不是", "no"]
apply:
  - prompt: "你的前端在 https://app.example.com,要呼叫 https://api.example.com。會遇到什麼問題?怎麼解?"
    rubric:
      - "有指出這是跨來源請求"
      - "有提到需要伺服器端設定允許"
      - "沒有事實錯誤"
`,
  'questions/sec-0002.yaml': `card: sec-0002
fill:
  - prompt: "跨來源時,決定網頁能不能讀到回應的是 ___。"
    answers:
      - ["伺服器", "server", "後端"]
  - prompt: "帶憑證的跨來源請求,允許的來源 ___ 使用萬用字元。"
    answers:
      - ["不能", "不可以", "禁止"]
apply:
  - prompt: "同事說「我在前端加個設定就能繞過跨來源限制」。這個說法哪裡有問題?"
    rubric:
      - "有指出決定權在伺服器"
      - "有說明前端無法自行授權"
`,
  'questions/sec-0003.yaml': `card: sec-0003
fill:
  - prompt: "預檢請求會在正式請求 ___ 送出。"
    answers:
      - ["之前", "前", "before"]
  - prompt: "預檢的結果可以被 ___ 一段時間。"
    answers:
      - ["快取", "cache", "暫存"]
apply:
  - prompt: "為什麼瀏覽器要多一趟預檢?直接送出不是更快嗎?"
    rubric:
      - "有提到保護不預期收到跨來源寫入的舊系統"
      - "有意識到這是安全與效能的取捨"
`,
};

/** state/reviews.json 的等價內容,直接寫成物件(省一次 JSON.parse)。全部今天到期。 */
export const REVIEWS_SEED: Record<
  string,
  { stage: 1 | 2 | 3; learned_at: string; next_due: string; fails_in_row: number; total_fails: number; stuck: boolean }
> = {
  'sec-0001': { stage: 1, learned_at: '2026-09-09', next_due: '2026-09-10', fails_in_row: 0, total_fails: 0, stuck: false },
  'sec-0002': { stage: 2, learned_at: '2026-09-01', next_due: '2026-09-09', fails_in_row: 0, total_fails: 0, stuck: false },
  'sec-0003': { stage: 3, learned_at: '2026-08-01', next_due: '2026-09-10', fails_in_row: 0, total_fails: 1, stuck: false },
};

export const SETTINGS_YAML = `daily_cap: 10
weekly_target: 7
short_body_limit: 50
llm:
  cloud_provider: anthropic
  cloud_model: claude-sonnet-4-6
  local_model: qwen2.5:14b
`;

export function buildFsSeed(): Record<string, string> {
  return {
    ...QUESTIONS_YAML,
    'state/reviews.json': JSON.stringify(REVIEWS_SEED, null, 2),
    'config/settings.yaml': SETTINGS_YAML,
  };
}
