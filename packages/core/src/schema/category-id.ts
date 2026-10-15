/**
 * §1 `CategoryId` 的共用驗證函式(契約 1.4.0、ADR-067)。02-ingest 與 09-lint 從這裡引用。
 *
 * validateCategoryId(value: string): { ok: true } | { ok: false; rule: CategoryIdRule }
 *   rule 與 contracts/fixtures/path-segment-vectors.json 的 rule 欄同名:
 *   charset nfc leading-dot trailing-dot reserved empty separator length
 * formatCategoryIdRefusal(value, rule): string
 *   拒絕訊息,含原樣的值與 rule 名。
 *
 * 實作住在 @contracts/index.js,這裡只 re-export。依賴方向只能是 core → contracts:
 * `CategoryIdSchema`(contracts)本身就要擋不合法的分類,不能比契約寬,而 contracts 不准 import core。
 * 只有一份實作,schema、ingest、lint 三處的判定才不會分岔。
 */
export {
  CATEGORY_ID_MAX_BYTES,
  formatCategoryIdRefusal,
  validateCategoryId,
  type CategoryIdRule,
  type CategoryIdVerdict,
} from '@contracts/index.js';
