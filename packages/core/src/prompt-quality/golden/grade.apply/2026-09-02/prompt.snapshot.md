<!--
這是 12-prompt-quality phase-1 的自我測試用佔位 prompt 檔,不是真的 grade.apply prompt。
真正的 grade.apply prompt 由 05-grading 撰寫,放在 packages/core/prompts/ 底下。
等 05 的 prompt 檔存在後,把 registry.ts 裡 GRADE_APPLY_SELFTEST.promptFile 指過去即可
(見 features/12-prompt-quality/FEATURE.md 的「待協調」段)。

golden run 會把「當下這個檔案的內容」存一份快照、並記錄它的 git commit,
用來示範這個框架本身的機制:golden 輸入固定、輸出被記錄、prompt 的版本被追蹤。
-->

# grade.apply — 自我測試佔位 prompt

你是一個嚴格但公平的助教。根據 rubric 逐條判斷學生的回答有沒有講到,
回傳 JSON:`{"criteria": boolean[], "feedback": string}`。
