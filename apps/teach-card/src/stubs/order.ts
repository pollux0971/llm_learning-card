/**
 * 假的 order:直接用 id 排序,不讀 graph/deps.json(見 FEATURE.md「Wave 0 的重複」)。
 * phase-2 接上真檔案時換成讀 graph/order-<category>.json。
 */
export function fakeOrder(ids: string[]): string[] {
  return [...ids].sort();
}
