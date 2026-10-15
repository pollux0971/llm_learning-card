/**
 * 14-hud-skin / phase-1:視窗 API 的包裝。測試 agent 擁有。
 * 釘住的介面:hud/window-controls.ts
 *   createWindowControls(deps?: { isTauri?: () => boolean; loadWindow?: () => Promise<WindowLike> }) → WindowControls
 *   WindowControls = { available: boolean; minimize(); close(); startDragging(); startResizeDragging(direction) }(都回 Promise<void>)
 *   available 在建立時就決定(= deps.isTauri(),預設用 @tauri-apps/api/core 的偵測;在 node 裡一定是 false)
 *   不在 Tauri:四個方法都是不丟錯的空動作,loadWindow 一次都不呼叫
 *   在 Tauri:第一次用到才呼叫 loadWindow;close 呼叫視窗的 close(),不呼叫別的
 */
import { importHud, makeWindowSpy, type WindowControls, type ControlsDeps } from './test-support.js';

const create = async (deps?: ControlsDeps): Promise<WindowControls> =>
  ((await importHud('window-controls')) as { createWindowControls(d?: ControlsDeps): WindowControls }).createWindowControls(deps);

describe('不在 Tauri 裡', () => {
  it('available 是 false;四個方法都不丟錯、不載入視窗(must_catch:標題列在瀏覽器不能炸)', async () => {
    const spy = makeWindowSpy(false);
    const c = await create(spy.deps);
    expect(c.available).toBe(false);
    await expect(c.minimize()).resolves.toBeUndefined();
    await expect(c.close()).resolves.toBeUndefined();
    await expect(c.startDragging()).resolves.toBeUndefined();
    await expect(c.startResizeDragging('NorthEast')).resolves.toBeUndefined();
    expect(spy.loads).toBe(0);
    expect(spy.calls).toEqual([]);
  });

  it('不給任何 deps(node 裡沒有 Tauri):也是 available=false、不丟錯', async () => {
    const c = await create();
    expect(c.available).toBe(false);
    await expect(c.close()).resolves.toBeUndefined();
    await expect(c.minimize()).resolves.toBeUndefined();
  });

  it('建立時不呼叫 console.error / console.warn', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const c = await create(makeWindowSpy(false).deps);
      await c.close();
      expect(err).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    } finally { err.mockRestore(); warn.mockRestore(); }
  });
});

describe('在 Tauri 裡', () => {
  it('available 是 true;建立時還沒載入視窗(第一次用才載)', async () => {
    const spy = makeWindowSpy(true);
    const c = await create(spy.deps);
    expect(c.available).toBe(true);
    expect(spy.loads).toBe(0);
    await c.minimize();
    expect(spy.loads).toBe(1);
  });

  it('close 只呼叫視窗的 close():不 hide、不 destroy、不 exit(送出跟系統關閉同一個請求)', async () => {
    const spy = makeWindowSpy(true);
    const c = await create(spy.deps);
    await c.close();
    expect(spy.calls).toEqual(['close']);
  });

  it('minimize 只呼叫 minimize', async () => {
    const spy = makeWindowSpy(true);
    await (await create(spy.deps)).minimize();
    expect(spy.calls).toEqual(['minimize']);
  });

  it('startDragging 轉給視窗', async () => {
    const spy = makeWindowSpy(true);
    await (await create(spy.deps)).startDragging();
    expect(spy.calls).toEqual(['startDragging']);
  });

  it.each(['North', 'South', 'East', 'West', 'NorthEast', 'NorthWest', 'SouthEast', 'SouthWest'] as const)(
    'startResizeDragging(%s) 把方向原樣轉給視窗', async (dir) => {
      const spy = makeWindowSpy(true);
      await (await create(spy.deps)).startResizeDragging(dir);
      expect(spy.calls).toEqual([`startResizeDragging:${dir}`]);
    });

  it('兩次呼叫共用同一個視窗(loadWindow 不重複載入)', async () => {
    const spy = makeWindowSpy(true);
    const c = await create(spy.deps);
    await c.minimize();
    await c.startDragging();
    expect(spy.loads).toBe(1);
  });
});
