// Gherkin 為英文,使用 cucumber 預設語言,不需 language 標頭。
// 步驟定義的 TypeScript 載入方式依 @cucumber/cucumber 版本而異,
// Wave 0 開始時依官方文件確認 loader 設定,並把結論寫進 ADR。
// @cucumber/cucumber 11 的設定檔規則:top-level 的 `export default` 本身就是 "default" 這個
// profile 的內容,不需要(也不能)再包一層 `default: {...}`——包了那一層會讓 paths/import/tags
// 全部被忽略(讀到的是 { default: {...} } 這個物件,none of its keys 對得上 schema),
// cucumber 會安靜地退回內建預設值,而 import 完全不會發生,所有 step 都變成 undefined。
// 想要額外的 profile 用具名 export(例如 `export const ci = {...}`),不要塞進這個物件裡。
export default {
  paths: ['features/**/*.feature', 'docs/integration/**/*.feature'],
  import: ['features/steps/**/*.ts'],
  tags: 'not @manual',
  format: ['progress'],
  publishQuiet: true,
};
