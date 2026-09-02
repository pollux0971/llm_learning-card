/** 本週通過 D1 的張數是否達標。 */
export function isTargetMet(passed: number, target: number): boolean {
  return passed >= target;
}
