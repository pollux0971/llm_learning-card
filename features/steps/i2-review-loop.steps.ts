/**
 * I2 整合的步驟定義(docs/integration/i2-review-loop-headless.feature)。
 *
 * 目前只涵蓋 Background 與兩個 @regression 場景——「空 vault 不可以看起來像
 * 安靜的一天」。其餘場景的步驟仍未定義,那是 I2 驗收時的工作,不是這一輪的。
 *
 * 這兩個場景刻意 spawn 真的 `scripts/review.ts`(走 `this.runCommand`),不像
 * review-cli.steps.ts 那樣直接呼叫 session 模組:要守的東西就是**使用者在終端機
 * 看到的字與退出碼**,繞過 CLI 等於繞過受測物。`--dry-run` 不進 readline 迴圈,
 * 所以不會有「等 stdin 卡住」的問題。
 */
import { Given, Then, When } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LearningWorld } from './_world.js';

/** 使用者每天看到的那句話。0 張卡的時候絕不可以出現。 */
const NOTHING_DUE = 'Nothing is due today.';

function dirOf(world: LearningWorld): string {
  assert.ok(world.dir, 'Background 應該先建立 learning 目錄(useFixture)');
  return world.dir;
}

/** 直接數磁碟上的卡片檔,拿來跟 CLI 印出來的數字對照——不共用 CLI 自己的計算。 */
function countCardsOnDisk(dir: string): number {
  const cardsDir = join(dir, 'cards');
  let total = 0;
  for (const category of readdirSync(cardsDir)) {
    if (!statSync(join(cardsDir, category)).isDirectory()) continue;
    total += readdirSync(join(cardsDir, category)).filter((n) => n.endsWith('.md') && !n.endsWith('.short.md')).length;
  }
  return total;
}

function outputOf(world: LearningWorld): string {
  assert.ok(world.lastRun, '還沒有跑過任何指令(When 要呼叫 runCommand)');
  return world.lastRun.output;
}

// ---------------------------------------------------------------- Given

Given('the settings have daily_cap {int}', function (this: LearningWorld, cap: number) {
  const path = join(dirOf(this), 'config/settings.yaml');
  const text = readFileSync(path, 'utf8');
  assert.match(text, /^daily_cap:/m, `settings.yaml 沒有 daily_cap 欄位:\n${text}`);
  writeFileSync(path, text.replace(/^daily_cap:.*$/m, `daily_cap: ${cap}`), 'utf8');
});

Given('the vault has no cards at all', function (this: LearningWorld) {
  // cards/ 整個消失——目錄被搬走 / 路徑改了 / 同步刪掉之後真正會看到的樣子。
  rmSync(join(dirOf(this), 'cards'), { recursive: true, force: true });
});

Given('the vault has cards and none of them fall due today', function (this: LearningWorld) {
  const dir = dirOf(this);
  assert.ok(countCardsOnDisk(dir) > 0, '這個場景需要 vault 裡真的有卡片');

  // 每張卡都排好了,只是都排在很久以後——這才是「正常的安靜日」,
  // 跟「卡片全部不見」必須長得不一樣。
  const reviews: Record<string, unknown> = {};
  const cardsDir = join(dir, 'cards');
  for (const category of readdirSync(cardsDir)) {
    for (const name of readdirSync(join(cardsDir, category))) {
      if (!name.endsWith('.md') || name.endsWith('.short.md')) continue;
      reviews[name.slice(0, -'.md'.length)] = {
        stage: 2,
        learned_at: '2026-08-01',
        next_due: '2026-12-01',
        fails_in_row: 0,
        total_fails: 0,
        stuck: false,
        history: [],
      };
    }
  }
  writeFileSync(join(dir, 'state/reviews.json'), `${JSON.stringify(reviews, null, 2)}\n`, 'utf8');
});

// ---------------------------------------------------------------- When

When('the person asks what is due today', function (this: LearningWorld) {
  this.runCommand(`npx tsx scripts/review.ts --dir ${dirOf(this)} --today ${this.today} --dry-run`);
});

// ---------------------------------------------------------------- Then

Then('the command says the vault has no cards', function (this: LearningWorld) {
  const output = outputOf(this);
  assert.match(output, /沒有卡片|一張卡片也沒有/, `應該明講這個 vault 沒有卡片:\n${output}`);
  assert.match(output, /(^|\D)0\s*張卡/, `應該把 0 這個數字印出來:\n${output}`);
});

Then('it does not say that nothing is due today', function (this: LearningWorld) {
  const output = outputOf(this);
  assert.ok(!output.includes(NOTHING_DUE), `0 張卡的時候不可以印「${NOTHING_DUE}」:\n${output}`);
});

Then('the command reports how many cards it looked at', function (this: LearningWorld) {
  const output = outputOf(this);
  const m = /(\d+)\s*張卡/.exec(output);
  assert.ok(m, `輸出裡沒有「N 張卡」:\n${output}`);
  assert.equal(
    Number(m[1]),
    countCardsOnDisk(dirOf(this)),
    `印出來的張數跟磁碟上的卡片數不一致:\n${output}`,
  );
});

Then('it says nothing is due today', function (this: LearningWorld) {
  const output = outputOf(this);
  assert.ok(output.includes(NOTHING_DUE), `安靜的一天仍然要說「${NOTHING_DUE}」:\n${output}`);
});
