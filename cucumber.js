// Gherkin 為英文,使用 cucumber 預設語言,不需 language 標頭。
// 步驟定義的 TypeScript 載入方式依 @cucumber/cucumber 版本而異,
// Wave 0 開始時依官方文件確認 loader 設定,並把結論寫進 ADR。
export default {
  default: {
    paths: ['features/**/*.feature', 'docs/integration/**/*.feature'],
    import: ['features/steps/**/*.ts'],
    tags: 'not @manual',
    format: ['progress'],
    publishQuiet: true,
  },
};
