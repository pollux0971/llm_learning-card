# P-29 測試輪回報:Stryker 跨 worktree 檔案鎖

commit `a31a6ef`(未 push)。這一輪**只寫測試**,`scripts/mutate.ts` 的 13 個函式體留 TODO。

## 1. 鎖路徑怎麼算的

```ts
export function strykerLockPath(cwd: string = process.cwd()): string {
  const out = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd, encoding: 'utf8' }).trim();
  return join(dirname(resolve(cwd, out)), LOCK_FILENAME);   // LOCK_FILENAME = '.stryker.lock'
}
```

`--git-common-dir` 在任何 worktree 裡都指向**主 repo 的 `.git/`**,取上一層就是主 repo 的
工作目錄。主 repo 裡 git 會回相對路徑(`.git`),所以先 `resolve(cwd, out)` 再 `dirname`。

五條測試釘住它:兩個 worktree 相同、worktree 與主 repo 相同、就是 `<主repo>/.stryker.lock`、
一定是絕對路徑、worktree 的子目錄也相同。fixture 是真的 `git init` + `git worktree add` 兩個。

## 2. 三個邊界的判斷

| 邊界 | 決定 | 標記 | 理由 |
|---|---|---|---|
| `startedAt` 剛好 2 小時 | **還是活鎖**,只有嚴格大於才算殘 | 【驗】 | 規格寫「**超過** 2 小時」。兩條測試(剛好 2h → live、2h+1ms → stale、2h-1ms → live)把 `>` 跟 `>=` 分開,M3 反向驗證確認會紅 |
| 鎖檔壞掉(不是合法 JSON) | 分兩段:mtime 在 **10 秒**寬限期內 → 當**活鎖**;超過 → 殘鎖刪掉 | 【推】 | `openSync('wx')` 建檔與寫內容是兩步,中間幾毫秒別人讀到的是空檔案——那不是壞,是還沒寫完,刪掉等於搶走別人剛拿到的鎖。真的壞掉(寫到一半被 OOM 殺)則會擋滿 90 分鐘,所以要能清。用 mtime 分兩段兩邊都顧到 |
| `process.kill(pid,0)` 丟 `EPERM` | **當活的**,不算殘鎖 | 【驗】 | EPERM 證明那個 pid **存在**,只是不是我的。當殘鎖就會刪掉別人正在用的鎖,正是這支要防的踩踏。只有 `ESRCH` 算死;其他錯誤碼同樣往「活著」保守 |

另外兩個順手決定的(都是【推】):
- `startedAt` 在**未來**(NTP 校時 / 跨機器)不算殘鎖——負的年齡不能被當成「超過兩小時」。
- `releaseLock` **只刪自己的**(鎖檔 pid 對得上才 unlink)。誤刪別人的鎖是立刻踩踏,
  留下殘鎖最多兩小時後自己過期。鎖檔壞到讀不出 pid 時也不刪。

## 3. 反向驗證

測試骨架本身是 TODO(全紅),所以先在 scratchpad 補了一份參考實作,對它做五個變異。
**五個都被抓到。**

```
$ npx vitest run scripts/mutate.test.ts          # 參考實作,基準
      Tests  70 passed (70)

# M1:拿掉 runMutate 的 finally,改成成功路徑才 release
 FAIL  runMutate > Stryker 丟例外時鎖也要刪掉(這條就是 finally)
      Tests  1 failed | 69 passed (70)

# M2:拿掉 installCleanup 的 SIGINT / SIGTERM handler(只留 exit)
 FAIL  installCleanup > 掛上 SIGINT / SIGTERM / exit 三個 handler
 FAIL  installCleanup > SIGTERM 會 release,然後以 143 結束
 FAIL  installCleanup > SIGINT 會 release,然後以 130 結束
 FAIL  SIGTERM 之後鎖不留 > 跑到一半被 SIGTERM 殺掉,鎖檔不會留下來
      Tests  4 failed | 66 passed (70)

# M3:2 小時的 > 改成 >=
 FAIL  classifyLock > 剛好 2 小時 → 還是活鎖(規格是「超過」,不是「達到」)
      Tests  1 failed | 69 passed (70)

# M4:改用 --show-toplevel,鎖放在自己 worktree 的根(經典寫錯法)
 FAIL  strykerLockPath > 兩個不同 worktree 算出來是同一個鎖路徑
 FAIL  strykerLockPath > worktree 與主 repo 算出來也是同一個
 FAIL  strykerLockPath > 鎖就在主 repo 的 .git 旁邊,檔名 .stryker.lock
 FAIL  strykerLockPath > worktree 的子目錄算出來還是同一個
      Tests  4 failed | 66 passed (70)

# M5:EPERM 也當成殘鎖
 FAIL  pidIsAlive > EPERM(程序在,只是不是我的)算活的
 FAIL  pidIsAlive > 其他錯誤碼也當活的(不確定就別刪)
      Tests  2 failed | 68 passed (70)
```

**規格裡寫的是「拿掉 `finally` → 第 3 條(SIGTERM)必須紅」,實測不是這樣**:
`finally` 管的是正常結束與例外,SIGTERM 走的是 signal handler,兩條路各自獨立。
拿掉 `finally` 紅的是「Stryker 丟例外時鎖也要刪掉」(M1),拿掉 signal handler 紅的
才是 SIGTERM 那條(M2)。兩條都有測試守著,所以覆蓋沒有缺口,只是對應關係跟規格描述不同。

參考實作留在 `/tmp/claude-1000/.../scratchpad/mutate.impl.ts`(不進 git),開發輪可以參考。

## 4. 驗收數字

| 檢查 | 結果 |
|---|---|
| `npm run boundaries` | ✅ 掃描 195 個檔案,允許例外 11 條,**0 違規**(`scripts/mutate.ts` 與 `.test.ts` 已登記為 `infra`) |
| `npm run typecheck` | ✅ 0 錯誤 |
| `npx vitest run` | 80 個測試檔:**79 綠 / 1 紅**。總計 1578 條,**1510 綠 / 68 紅**,紅的全部在 `scripts/mutate.test.ts`(TODO 未實作)。既有測試**一條都沒被弄紅** |
| `npx vitest run scripts/mutate.test.ts` | 70 條,68 紅 2 綠。綠的兩條是接線檢查(`.gitignore` 有 `.stryker.lock`、`npm run mutate` 走 `scripts/mutate.ts`) |
| `npm run accept:dry` | ✅ 496 scenarios / 2264 steps,**0 ambiguous**(155 undefined 是既有的未實作 feature) |

沒有在主 repo 或任何 worktree 留下 `.stryker.lock`(測試全部用 `mkdtemp` 的臨時目錄,
`afterAll` 清掉)。

## 5. 開發輪要知道的三件事

1. **`isMainModule` 不是 TODO,是實作好的。** 它擋在頂層,留 TODO 會讓整個模組一 import
   就爆,68 個 TODO 就看不出是哪一條紅。
2. **不要用 top-level await。** 測試的臨時腳本在 repo 外面(沒有 `type: module` 的
   package.json),tsx 會當 CJS 轉譯,頂層 await 直接爆。已經改成 `.then()`。
3. **測試的子行程用 `node --import tsx`,不是 `npx tsx`。** npx 多包一層行程,
   `child.kill('SIGTERM')` 打在 npx 上,底下的 node 收不到,SIGTERM 那條會吊死。

## 6. 一個沒被規格涵蓋的缺口

鎖只保護**走 `npm run mutate` 的人**。repo 裡現有文件(`REVIEW.md`、各 `FEATURE.md`、
`.claude/skills/phase-acceptance/SKILL.md`)寫的幾乎都是直接叫 stryker CLI 的那條路,
**那條路繞過鎖**。`strykerArgs` 已經設計成能吃這些寫法:

```
npm run mutate -- --mutate "packages/core/src/x.ts,!packages/core/src/x.test.ts"
npm run mutate -- stryker.scanner-doclinks.json
```

文件要不要一起改,留給協調者決定——不改的話鎖只擋得住一半的人。
