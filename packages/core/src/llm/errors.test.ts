/**
 * `NoModelError` 的**訊息文字**與 `cause` 接線(收尾輪的審核補洞)。
 *
 * 為什麼要一個專門的測試檔:`NoModelError` 是契約 §7 路由表第三欄「離線+無本機」
 * 唯一的出口,而它的訊息是**使用者唯一看得到的東西**——`code` 給程式分支用,
 * 訊息給人看。9e98257 給建構子加了第二個 optional 參數 `{ detail?, cause? }`
 * 之後,「沒給 detail 時訊息一字不變」這件事沒有任何測試鎖住:
 *
 *   - `routing.test.ts` 只有 `toThrow(/deepen/)` 與 `toThrow(NoModelError)`,
 *     整句話只要還帶得出 task 名字就綠。
 *   - `router-gateway.test.ts` 只測**有** detail 的那一半(`/gateway/i` +
 *     `toContain(task)`)。
 *
 * 也就是說把 `options.detail === undefined ? '' : ...` 的條件寫反(沒給 detail
 * 時接一句 ` (undefined)`),現有測試**一條都不會紅**。使用者會看到
 * `... offline and no local model (undefined)`,而 CI 全綠。
 *
 * 所以這裡鎖的是**完整字串**,不是子字串比對——子字串比對擋不住「多接了一段」。
 */
import { describe, expect, it } from 'vitest';
import { CloudRequiredError, GatewayCallError, NoModelError } from './errors.js';

describe('NoModelError — 訊息文字', () => {
  it('不給 detail 時訊息一字不多(不能接出 "(undefined)" 這種尾巴)', () => {
    const err = new NoModelError('deepen');
    expect(err.message).toBe('task "deepen" has no model available: offline and no local model');
  });

  it('完全不給第二個參數與給空物件,訊息一模一樣', () => {
    // routing.ts 的兩處呼叫走的是前者;預設值 `= {}` 壞掉的話這條會紅。
    expect(new NoModelError('grade.fill.llm').message).toBe(new NoModelError('grade.fill.llm', {}).message);
  });

  it('給 detail 時接在後面的括號裡,前半段不變', () => {
    const err = new NoModelError('grade.apply', { detail: 'local gateway unreachable: boom' });
    expect(err.message).toBe(
      'task "grade.apply" has no model available: offline and no local model (local gateway unreachable: boom)',
    );
  });

  it('code / name / task 三個欄位是契約 §7 的那組', () => {
    const err = new NoModelError('reteach.short');
    expect(err.code).toBe('NO_MODEL');
    expect(err.name).toBe('NoModelError');
    expect(err.task).toBe('reteach.short');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('NoModelError — cause', () => {
  it('沒給 cause 時就是沒有 cause,不是一個 undefined 的殼', () => {
    const err = new NoModelError('deepen');
    expect(err.cause).toBeUndefined();
    // `new Error(msg, { cause: undefined })` 會**建立**一個值是 undefined 的
    // own property;沒給第二參數則整個 key 都不存在。差別看得到,鎖住它。
    expect(Object.prototype.hasOwnProperty.call(err, 'cause')).toBe(false);
  });

  it('給 cause 時掛的是**同一個物件**,不是複製或訊息字串', () => {
    const gatewayError = new GatewayCallError('token exchange failed: connect ECONNREFUSED');
    const err = new NoModelError('deepen', { cause: gatewayError });
    expect(err.cause).toBe(gatewayError);
  });

  it('detail 與 cause 可以只給其中一個', () => {
    expect(new NoModelError('deepen', { detail: 'x' }).cause).toBeUndefined();
    const boom = new Error('boom');
    expect(new NoModelError('deepen', { cause: boom }).message).toBe(
      'task "deepen" has no model available: offline and no local model',
    );
  });
});

describe('CloudRequiredError — 訊息文字(§7 的另一個出口,一起鎖住)', () => {
  it('訊息完整字串', () => {
    const err = new CloudRequiredError('ingest.cards');
    expect(err.message).toBe('task "ingest.cards" requires the cloud provider, but it is offline');
    expect(err.code).toBe('CLOUD_REQUIRED');
    expect(err.task).toBe('ingest.cards');
  });
});
