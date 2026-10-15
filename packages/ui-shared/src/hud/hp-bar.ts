/** 已完成 / 總數 → 0..100。不四捨五入;壞輸入夾進範圍,不丟錯。 */
export function hpPercent(done: number, total: number): number {
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0 || done <= 0) return 0;
  const raw = (done / total) * 100;
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  if (raw >= 100) return 100;
  return raw;
}
