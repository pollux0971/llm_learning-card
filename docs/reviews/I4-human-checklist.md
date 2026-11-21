# I4 給你做的三件事(人工清單)

> 寫的人:前端。先給技術顧問看過,再給你。
> 依據:[I4 盤點](I4-inventory.md) 第 6 節(顧問裁決:人工清單只剩三項)。
> 機器自己能測的部分都過了(`@integration and @i4 and not @manual`,8 個場景全過)。
> 剩下這三件,一定要**你本人**用**你真的 learning 資料夾**、**真的過幾天**才看得出來。

## 先看這段(30 秒)

- 三件事可以**一起做**。合起來大約 **9 天**,每天 5 到 10 分鐘。
- 不用改電腦時間。不用假資料。照平常用就好。
- 每做完一件,回一句話就好,例如:「第 1 件好了」或「第 1 件怪:考試卡沒出現那張」。
- 怪的地方說你看到什麼就好,不用猜原因。

## 「第 1 天」是哪一天

這是最重要的一句:

> **第 1 天 = 你第一次打開教學卡、按下「下一個」的那一天。**

- 「一天」看電腦上的日期。**過了半夜 12 點就是下一天。**
- 例子:你在 11 月 24 日晚上 10 點第一次按「下一個」,那 11/24 就是第 1 天,11/25 是第 2 天。
- 那天請記下日期,回給我們:「第 1 天是 11/24」。
- 中間漏了一天沒關係,告訴我們漏了哪天就好。卡片不會不見,只是會晚一天出現。

## 要用的指令

都在主簽出跑:

```bash
cd /data/python/llm_learning-cards
```

| 要做什麼 | 指令 |
|---|---|
| 開桌面程式(教學卡+考試卡兩個視窗) | `npm run tauri dev` |
| 在終端機複習今天的題 | `npx tsx scripts/review.ts --dir learning --today $(date +%F)` |
| 只看今天有哪些題到期,不答題 | `npx tsx scripts/review.ts --dir learning --today $(date +%F) --dry-run` |

- `$(date +%F)` 會自己換成今天的日期,照抄就好。
- 答「應用題」時會呼叫雲端模型批改,會花一點錢。每天有上限(1 美元),到上限會停,不會一直花。

## 時間表(三件一起做)

| 哪天 | 做什麼 | 大約多久 | 算哪一件 |
|---|---|---|---|
| 第 1 天 | 開桌面程式,在教學卡看 5 張卡,每張看完按「下一個」 | 5 分鐘 | 第 1 件、第 3 件的準備 |
| 第 2 天 | 開桌面程式,在**考試卡視窗**把今天的題全部答完 | 10 分鐘 | 第 1 件、第 3 件、第 2 件的第 2 天 |
| 第 3 到第 8 天 | 每天跑一次終端機複習指令(沒有題也跑,看它說什麼) | 每天 1 到 5 分鐘 | 第 2 件 |
| 第 9 天 | 再跑一次終端機複習指令 | 5 分鐘 | 第 2 件收尾 |

為什麼是第 9 天:第 2 天答對的卡,間隔是 7 天,所以 2 + 7 = 第 9 天回來。

---

## 第 1 件:今天學、明天考

**要做什麼**

1. 第 1 天:開桌面程式。教學卡會先給你「還沒學過」的第一張。看完按「下一個」。
   - 按了「下一個」,剛剛那張就算「學過了」,明天會出現在考試卡。
   - 按「換類別」也一樣會把當下那張算學過。
2. 第 2 天:開考試卡。剛剛那幾張要出現,而且是**填空題**。

**要看什麼**

- 第 1 天第一張是不是「還沒學過的」(不是你早就學過的)。
- 第 2 天,第 1 天學的那幾張有沒有出現在考試卡、是不是填空題。

**大約多久**:第 1 天 5 分鐘,第 2 天 5 分鐘。

**做完回**:「第 1 件好了」或「第 1 件怪:___」。

**場景原文**(在 [i4 整合檔](../integration/i4-two-card-system.feature) 第 12 行):

```gherkin
  @e2e @manual
  Scenario: A person learns a concept today and is asked about it tomorrow
    When the person opens the teach card
    Then the first unlearned card in the order file is shown
    When the person reads it and presses next
    Then that card is recorded as learned and due tomorrow
    When the clock advances one day
    And the person opens the test card
    Then that card appears as a fill question
```

背景(三個條件)是:桌面程式開著、learning 資料夾裡有分類、分類有排好的順序檔。你的 learning 資料夾本來就是這樣,不用另外準備。

---

## 第 2 件:連用一週(I2)

**要做什麼**

- 從第 2 天到第 8 天,每天複習一次(共 7 天)。第 2 天在視窗答,第 3 到第 8 天用終端機指令。
- 第 9 天再跑一次,看第 2 天答對的卡有沒有回來。

**要看什麼**

- 第 2 天:第 1 天學的卡有出現(跟第 1 件同一個畫面)。
- 第 9 天:第 2 天**答對**的卡又出現了。這次除了填空題,還會多一題**應用題**(要你用自己的話回答的題)。
- 第 2 天**答錯**的卡,不會等到第 9 天,隔天(第 3 天)就會再出現。這是對的。
- 整週有沒有怪事,例如:同一題一天問兩次、答完的題隔天還在、日期看起來不對。

**大約多久**:每天 1 到 10 分鐘,共 9 天。

**做完回**:「第 2 件好了」或「第 2 件怪:第 N 天 ___」。

如果你想自己翻紀錄檔看,它在 `learning/state/reviews.json`。不想看也可以,上面的畫面看起來對就算。

**場景原文**(在 [i2 整合檔](../integration/i2-review-loop-headless.feature) 第 112 行):

```gherkin
  @manual
  Scenario: A person actually uses it for a week
    When the person runs the review command daily for seven days
    Then cards learned on day one come back on day two
    And cards passed on day two come back seven days later
    And nothing in state/reviews.json looks wrong on inspection
```

---

## 第 3 件:在視窗裡做完一輪複習(I3)

**要做什麼**

- 第 2 天,打開考試卡視窗,把今天到期的題**全部**答完。(跟第 1 件第 2 天是同一次,不用多做。)

**要看什麼**

- 一打開,上面那行寫「0 / 幾題」,而且沒有說有逾期。
  - 「逾期」= 本來更早該複習、但你沒做的題。第 1 天才學,所以應該沒有。
  - 題數可能不是 5:你原本就有到期的卡,也會一起算進去。對得上就好。
- 答完後有一個小結,寫答對幾題、退回幾題。
- 關掉再開,或在終端機跑 `--dry-run` 那條指令,今天答過的題不會再出現。這代表答案真的存進檔案了。

**大約多久**:10 分鐘。

**做完回**:「第 3 件好了」或「第 3 件怪:___」。

**場景原文**(在 [i3 整合檔](../integration/i3-desktop-review.feature) 第 11 行):

```gherkin
  @e2e @manual
  Scenario: A person completes a review session in the window
    When the person opens the test card window
    Then the header shows zero of five and that none are overdue
    And the first question is displayed
    When the person answers all five questions
    Then the summary shows the pass and return counts
    And "state/reviews.json" on disk reflects every answer
```

---

## 給顧問(使用者可跳過)

- **Q1 第 2 天在視窗答,算不算 I2 的「每天跑複習指令」那一天?** 視窗和終端機共用同一份核心程式與同一份 `state/reviews.json`(I3 的自動場景「The window and the terminal see the same state」守著)。我的建議是**算**,這樣三件可以疊在同一天,使用者少做一次。不算的話,第 2 天要改成先用終端機答,第 3 件另找一天做(要再有到期的卡)。
- **Q2 第 3 件的「zero of five」。** 場景假設剛好 5 張到期。真資料的題數不一定是 5。清單寫成「對得上就好」;要硬湊 5 張的話,第 1 天要先看使用者原本有幾張到期,那會讀到使用者資料,所以我沒這樣寫。
- 這三件跟 i4 第 55 行、第 63 行的 `@manual` 無關。那兩條照盤點第 6 節由顧問用既有證據判,不給使用者。
