/**
 * ADR-034:.env 只在 CLI 入口用 Node 內建的 process.loadEnvFile 載入,檔案不存在時吞掉錯誤;
 * library 程式碼(router.ts 等)只讀 process.env,不碰檔案。
 *
 * 原意是「所有 scripts/*.ts 入口都要載入」,不是只有 scripts/llm.ts 自己重複一份。
 * 每個 CLI 入口在最前面 `import './_env.js'`(side-effect import)即可。
 *
 * 沒載入的後果不是「功能壞掉」,是體驗差:沒設環境變數時,直接丟一個
 * 沒有前後文的 MissingCredentialError stack trace,而不是像 llm.ts 一樣先把
 * .env 讀進來、更貼近使用者實際會遇到的情境。
 */
try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch {
  // 沒有 .env 就用現有的 process.env,例如 CI 直接注入變數
}
