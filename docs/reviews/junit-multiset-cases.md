# 為什麼合併時比 junit 要用 multiset,不看總數 —— 三個實際案例

合併之後留一份 junit,下一次合併時對 testcase 做 diff。**比的是「完整限定名的 multiset」
(檔案 + suite + name,而且同名要各算一筆),不是總數,也不是 `set(names)`。**

兩種偷懶各自會漏掉什麼:

- **只看總數** → 「進幾條、出幾條」互相抵消,看起來沒事。
- **用 `set(names)`** → 本 repo **一直都有同名 testcase**(參數化案例),用集合比會憑空少掉那幾筆,
  而那本身就是一個「看起來乾淨」的假象。

量法(**不要記數字,它會腐爛**;要用就當場量):

```python
import xml.etree.ElementTree as ET
from collections import Counter
def load(p):
    c = Counter()
    for tc in ET.parse(p).getroot().iter('testcase'):
        c[(tc.get('classname', ''), tc.get('name', ''))] += 1
    return c
old, new = load('reports/junit/<舊 sha>.xml'), load('reports/junit/<新 sha>.xml')
print('少掉的:', sum((old - new).values()))
print('新增的:', sum((new - old).values()))
```

## 案例一(別的專案,這套做法的由來)

branch 8044 = 8036 + 4 + 4、main 8044 = 8036 + 8。**總數相等,組成不同,內容少了四條。**
只看數字完全看不出來。

## 案例二(本 repo,2026-09-05)

這份文件曾經寫死「1691 個 testcase / 1683 個不重複 / 8 個同名」。實測已經是
**2689 / 2680 / 9**。**寫死的數字本身就是會腐爛的東西**,所以現在只留量法不留數字。

## 案例三(本 repo,2026-09-12,`env-probe` 合併)

`634be7f` → `e61b326`:

```
總數 2967 → 2972
少掉的:5     新增的:10
```

**只看總數會讀成「+5,沒事」。實際是 5 進 10 出。**

逐條看過之後的真相:

- 那 **5 條「少掉」的其實是改名加強** —— `llm-spend.test.ts` 的「整份檔都不是 JSONL」那組,
  名字尾巴多了「/ 怎麼修 / 哪一種壞」,是審核輪把 `NOT_JSON` 與 `NOT_EVENT` 訊息拆開時加的斷言。
- 另外 **5 條是真的新增** —— 1 條 `ts 是數字不是字串` 的邊界(補一個活下來的變異),
  4 條 `[missing] LLM_DAILY_CAP_USD 是空字串` 的零輸入探針。

**淨少 0。** 但這個結論是**逐條看過才敢下的**,不是從「+5」推出來的。

### 這個案例的重點

「少掉 5 條」在這次是良性的(改名),但**它跟真的刪掉 5 條長得一模一樣**。
multiset 的價值不是自動判斷好壞,是**強迫你去看那 5 條是誰**。
看到「少掉的:0」才可以不看;只要非 0,就要逐條列出來配對。
