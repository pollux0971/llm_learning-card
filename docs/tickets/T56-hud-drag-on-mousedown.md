---
id: T56
deps: [T54]
touches: [packages/ui-shared/src/hud/HudResizeHandles.svelte, packages/ui-shared/src/hud/HudTitleBar.svelte, packages/ui-shared/src/hud/hud-drag-wiring-render.test.ts]
cpu: light
budget_usd: 1
status: todo
owner: worker-grok
must_catch:
  - 只有 mousedown、沒有 pointerdown 的那一下(WebKitGTK 在桌面接手拖拉之後就是這樣)沒有開始拖拉:渲染測試 d 必須紅(現況紅)
  - 右鍵或中鍵按下也開始拖拉(現況任何鍵都會):渲染測試 b 必須紅
  - 一次左鍵按下開始兩次(例如 mousedown 與 pointerdown 都接):渲染測試 e 必須紅
  - 按標題列上的縮小或關閉鈕也開始移動視窗:渲染測試 c 必須紅
  - 左鍵按在把手或標題列上卻沒有開始(接線壞了),或縮放的方向不對:渲染測試 a 必須紅
  - 連續兩次真的拖拉,第二次不動:@manual 必須有壞的
  - HUD 既有測試(hud-static、components、window-controls、window-frame、card-static、card-render)、教學卡與考試卡的測試任一變紅:不退步必須紅
  - 實作動到 touches 以外的檔:不動的地方那條 diff 必須有輸出
---

# 工單 T56:HUD 的縮放把手與標題列,改在 `mousedown` 開始拖拉、只認左鍵(T54 的修正)

> 狀態:起草 2026-10-25,依技術顧問 2026-10-25 對 T54 調查報告的裁決(開修正工單,優先度中上)。規格:UI/Tauri 負責人。編號 T56:協調者配的。
> 實作:worker(opencode + grok-4.7);紅測試:測試 agent;驗收:驗收 agent;`@manual`:前端,技術顧問判。
> 依據:`../reviews/T54-investigation.md`(結論、E1–E8、E6a);`T54-hud-resize-first-drag-investigation.md`;14-hud-skin phase-1 的元件。
> 基底:main(T54 報告合併之後)。LLM 真呼叫 0。

## 為什麼有這張

T54 量到(X11 與 Wayland 都一樣):

- 一次拖拉被桌面接手(縮放或移動)之後,放開給了桌面。WebKitGTK 的 pointer 狀態一直停在「按著」。
- 下一次按下,頁面只收到 `mousedown`,**沒有 `pointerdown`**。
- HUD 的縮放把手(`../../packages/ui-shared/src/hud/HudResizeHandles.svelte:26`)與標題列(`../../packages/ui-shared/src/hud/HudTitleBar.svelte:13`)都掛在 `onpointerdown`,所以第二次拖拉不動:縮放變成選字,移動沒反應。中間點一下(完整的按下放開)才回正。
- 真人會遇到:連續移動 HUD 視窗兩次,第二次不動(E8 4/4、Wayland 4/4)。
- 丟棄式改成 `onmousedown`:X11 的 R、E1、E4 0/12 壞,Wayland 0/4 壞。`onpointerdown` 加 `preventDefault` 沒用(6/6 壞)。
- 顧問 grep 過 `apps/*/src` 與 `packages/ui-shared`:`onpointerdown` 只有這兩處。

## 要的結果

1. **縮放把手**(`HudResizeHandles.svelte`):在 `mousedown` 開始縮放,只有左鍵(`button === 0`)才開始,方向照舊(八個邊各自的 `data-hud-edge`)。不再掛 `pointerdown`。
2. **標題列**(`HudTitleBar.svelte`):在 `mousedown` 開始移動,只有左鍵才開始。
   - **擋按鈕的方法照舊**:現在的 `onDrag` 用 `event.target` 的 `closest('button')` 判斷,按在縮小或關閉鈕上就不開始移動。改成 `mousedown` 之後用同一種判斷。按鈕自己的 `onclick`(縮小、關閉)不動。
3. **一次左鍵按下,剛好開始一次**(`startResizeDragging` 或 `startDragging` 各叫一次,不重複)。
4. **不加 `preventDefault`**:T54 量過沒用;擋掉 `mousedown` 的預設動作還會改到焦點。
5. 不變的:`window-controls.ts`、把手的大小位置與游標(`hud.css`)、tao 自己的 5 px 縮放邊、按鈕與面板的樣子。

## 驗收條件

### 1. 自動驗收(測試 agent 寫)

| 層 | 指令 | 過的條件 |
|---|---|---|
| ui-shared | `VITEST_MAX_WORKERS=1 npx vitest run packages/ui-shared/src/` | 全綠,含新的渲染測試 |
| 教學卡、考試卡 | `VITEST_MAX_WORKERS=1 npx vitest run apps/teach-card/ apps/test-card/` | 全綠 |
| 不退步 | `NODE_OPTIONS=--import=tsx npx cucumber-js --tags '@hud-skin and not @manual' --format summary` | 全綠(拿位子) |
| 不動的地方 | `git diff --stat <紅測試分支的基底>..HEAD -- packages/ui-shared/src/hud/window-controls.ts packages/ui-shared/src/hud/hud.css apps contracts packages/core scripts features` | 沒有輸出 |

**渲染測試**(新檔 `packages/ui-shared/src/hud/hud-drag-wiring-render.test.ts`;真的在 Chrome 畫出來,SKILL §4g 第 29 條,**不准**比對原始碼字串):

- 怎麼看得到「開始了沒」:`openApp` 加 `initScript`,放 `@tauri-apps/api/core` 的 `isTauri()` 認得的全域,和一個假的 Tauri 內部 `invoke`,把命令名與參數記下來(名字以 repo 用的 `@tauri-apps/api` 版本為準,測試 agent 先讀)。頁面用展示頁或教學卡都可以,要有標題列與八個把手。
- 要點出的狀態:
  - **a. 左鍵**:用 CDP 送真的滑鼠按下放開,八個把手各一次、標題列文字一次 → 各叫一次對應的開始(縮放帶對的方向)。
  - **b. 右鍵、中鍵**:同樣的位置 → 一次都不叫。
  - **c. 按鈕**:按縮小鈕、關閉鈕 → 不叫 `startDragging`;按鈕自己的動作照舊(縮小、關閉各一次)。
  - **d. 連續兩次拖拉的第二次**:Chrome 裡沒有桌面接手,所以照 T54 量到的樣子模擬第二次:第一次用 CDP 真的左鍵按下放開;第二次在同一個把手(與標題列)上**只發 `mousedown`、不發 `pointerdown`**(頁面裡 `dispatchEvent` 一個左鍵的 `MouseEvent`)→ 第二次也要開始。另外只發 `pointerdown`、不發 `mousedown` → **不開始**(證明開始的是 `mousedown`)。
  - **e. 不重複**:一次真的左鍵按下放開 → 剛好一次。
- 在基底(T54 合併後的 main)上:**b、d 紅**(現在任何鍵都開始;只有 `mousedown` 時不開始、只有 `pointerdown` 時會開始),紅的原因是「還沒有這個功能」。a、c、e 本來就綠,是護欄。紅綠寫進紅測試的 commit 說明。
- 這張的元件接線沒有純邏輯模組,不跑變異測試。

### 2. 改壞證明(驗收 agent 的丟棄式證明)

`must_catch` 每一條各做一次:改了哪裡、哪一條紅、紅的訊息原文、還原後綠。至少:

- 改回 `onpointerdown` → d 紅;
- 拿掉 `button === 0` 的判斷 → b 紅;
- `mousedown` 與 `pointerdown` 都接 → e 紅;
- 拿掉標題列的 `closest('button')` → c 紅;
- 把手的方向寫錯一個 → a 紅。

### 3. 觀感(`@manual`,前端做、技術顧問判)

T56 合併後,前端照 T54 的做法量(暫存根 + 假網路、巢狀 GNOME Shell、ibus-daemon 替身、MemoryMax=2G、LLM 真呼叫 0、真的 learning/ 前後相同,不碰 `:1`)。每一次記 T54 那幾層(頁面事件、按下前的 mask、視窗大小與位置)。

| 列 | 做法(同 T54 報告) | 過的條件 |
|---|---|---|
| R(X11) | 拖到最小 → 不點 → 從 360×400 拖右下角 | ≥ 5 次,0 壞 |
| E1(X11) | 拖角接上 → 不點 → 再拖角 | ≥ 5 次,0 壞 |
| E4(X11) | 標題列移動 → 不點 → 拖角 | ≥ 5 次,0 壞 |
| E8(X11) | 標題列移動 → 不點 → 再移動(**連續移動兩次,第二次也動**) | ≥ 5 次,0 壞 |
| E1(Wayland) | 同 E1 | ≥ 5 次,0 壞 |
| E5(X11,起草時補的) | 右邊離邊 3 px(tao 自己的縮放邊與頁面的把手都會接)拖完 → 不點 → 再拖 | ≥ 5 次,0 壞(改了之後兩邊都會開始縮放,要確認沒有變壞) |
| E7b(Wayland,起草時補的) | 標題列移動 → 不點 → 再移動 | ≥ 5 次,0 壞 |

顧問判過才收。

## 受保護的檔(開發 worker 不改)

- 測試:`*.test.ts`、`*-test-support.ts`、`features/**`、`.feature`。worker 覺得測試有錯,寫進報告的「待協調」,不改。
- 實作:`packages/ui-shared/src/hud/` 裡除了 `HudResizeHandles.svelte`、`HudTitleBar.svelte` 以外的檔、`apps/`、`contracts/`、`packages/core/`、`scripts/`。

## 落點

`packages/ui-shared/src/hud/` → 14-hud-skin(`../../scripts/boundaries.owners.json`)。不新增 import 例外。

## 顧問的裁決(2026-10-25,T54 調查報告)

- 報告通過。開修正工單,優先度中上。
- 修法:`HudResizeHandles` 與 `HudTitleBar` 改 `onmousedown`、只認 `button === 0`。`onpointerdown` 只有這兩處。
- must_catch:右鍵 / 中鍵開始拖 → 紅;一次按下開始兩次 → 紅;點標題列上的縮小 / 關閉鈕不准開始移動 → 紅(擋法照舊)。
- 紅測試量接線(按哪個鍵叫不叫開始);真的壞不壞只有 WebKitGTK 加視窗管理員量得到,`@manual` 用 R、E1、E4、E8(X11)與 E1(Wayland),每種 ≥ 5 次,要 0 壞。
- 上游 WebKitGTK:不報(對外發佈要使用者點頭,而且自己的繞法已經夠)。
- 請使用者在真桌面試:不用;真人確認留到 I4 的 `@e2e`。

**起草時補的**(請顧問看):

1. 渲染測試 d:用「只發 `mousedown`、不發 `pointerdown`」在 Chrome 裡模擬 WebKitGTK 被桌面接手之後的那一下,讓「連續兩次拖拉的第二次」這個狀態轉換在自動測試就看得到(協調者要的第 1 點)。另外「只發 `pointerdown`」→ 不開始,釘住開始的是 `mousedown`。
2. `@manual` 加 E5(離邊 3 px):改了之後,這裡 tao 與頁面都會開始縮放,要確認沒有變壞。加 E7b(Wayland 的連續移動兩次)。

## 不在範圍

- 回報上游、觸控拖標題列、tao 的縮放邊、把手的大小與游標。
- `onpointerdown` 以外的事件處理。

## 預算

`budget_usd: 1`(兩個元件各改幾行;grok 不設停止線,只記錄)。沒有 LLM 花費。

`cpu: light`:沒有 Rust。渲染測試會起 vite dev server 與 headless Chrome;cucumber 是重活,協調者照重活排位子。`@manual` 是前端的重活(巢狀 session),協調者排位子。

## 測試誰寫

- 紅測試(渲染 a–e):測試 agent。改壞證明:驗收 agent。開發 worker 以紅測試分支為基底,不改測試。
- `@manual`:前端,技術顧問判。

## worktree

- 一個 worktree,從 `/data/python/llm_learning-cards-workers` 開,基底是紅測試分支的 tip,同一時間只給一個 agent。派工歸協調者。
