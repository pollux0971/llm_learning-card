/**
 * 07-teach-card / phase-1 的步驟定義。
 *
 * 「the development server is running against the rich fixture set」跟 06-test-card
 * 逐字相同,已移到 common.steps.ts 用 tag 分派,這裡不重複定義。
 */
import { Given, When, Then } from '@cucumber/cucumber';
import { strict as assert } from 'node:assert';
import type { LearningWorld } from './_world.js';
import { renderMarkdown, EXAMPLE_CLASS } from '../../packages/ui-shared/src/index.js';
import { createDeck, currentCardId, pressNext, type DeckState } from '../../apps/teach-card/src/lib/deck.js';
import { fakeOrder } from '../../apps/teach-card/src/stubs/order.js';

// fixture-data.ts 用 Vite 的 `?raw` import 讀卡片內容,只在 Vite/vitest 底下能跑,
// cucumber 用純 tsx(沒有 Vite 轉譯層)沒辦法載入它。這裡只需要卡片 id 順序,不需要內容,
// 所以直接對同一組 id 呼叫同一個 fakeOrder(),不 import fixture-data.ts 本身。
const CARD_IDS = ['sec-0001', 'sec-0002', 'sec-0003', 'sec-0020', 'sec-0021', 'sec-0022', 'sec-0023'];
const ORDER = fakeOrder(CARD_IDS);

// 每個 scenario 一個 World 實例,用 WeakMap 掛 deck 狀態,不用改 _world.ts。
const decks = new WeakMap<LearningWorld, DeckState>();
const initialCard = new WeakMap<LearningWorld, string | null>();

export function getOrCreateDeck(world: LearningWorld): DeckState {
  let deck = decks.get(world);
  if (!deck) {
    deck = createDeck(ORDER);
    decks.set(world, deck);
    initialCard.set(world, currentCardId(deck));
  }
  return deck;
}

function stripFrontmatter(text: string): string {
  // gray-matter 對沒有 frontmatter 的文字直接原樣回傳 content,兩種 Given 都能共用這個 When。
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text);
  return m ? text.slice(m[0].length) : text;
}

// ---------------------------------------------------------------- Given

Given('a card whose example fence contains a list, bold text and a code block', function (this: LearningWorld) {
  this.cardText = this.readFixture('cards/valid-example-with-nested-content.md');
});

Given(/^a fenced block with the language (.+)$/, function (this: LearningWorld, lang: string) {
  const info = lang === '(none)' ? '' : lang;
  this.cardText = '```' + info + '\ncontent line\n```\n';
});

// ---------------------------------------------------------------- When

When('it is rendered', function (this: LearningWorld) {
  assert.ok(this.cardText, 'this.cardText 還沒設定(Given 步驟要先讀卡片原文)');
  this.resultText = renderMarkdown(stripFrontmatter(this.cardText));
});

When('a card is displayed', function (this: LearningWorld) {
  getOrCreateDeck(this);
});

When('the person presses next', function (this: LearningWorld) {
  pressNext(getOrCreateDeck(this));
});

When('a card is displayed and the interface is closed without pressing anything', function (this: LearningWorld) {
  getOrCreateDeck(this);
});

// ---------------------------------------------------------------- Then

Then('opening it shows the first card of the first category', function (this: LearningWorld) {
  const deck = getOrCreateDeck(this);
  assert.equal(currentCardId(deck), ORDER[0]);
});

Then('the list and bold text are rendered as markdown', function (this: LearningWorld) {
  const html = this.resultText as string;
  assert.match(html, /<li>/, 'expected a rendered list item');
  assert.match(html, /<strong>/, 'expected rendered bold text');
});

Then('the code block inside it is still rendered as code', function (this: LearningWorld) {
  const html = this.resultText as string;
  assert.match(html, /<pre><code/, 'expected the nested code fence to still render as code');
});

Then('the fence itself is not rendered as preformatted text', function (this: LearningWorld) {
  const html = this.resultText as string;
  const exampleIdx = html.indexOf(`class="${EXAMPLE_CLASS}"`);
  assert.notEqual(exampleIdx, -1, 'expected an example block to be rendered');
  const preIdx = html.indexOf('<pre>');
  assert.ok(preIdx === -1 || exampleIdx < preIdx, 'the example container itself must not be a <pre> wrapper');
});

Then('no empty example area is shown', function (this: LearningWorld) {
  const html = this.resultText as string;
  assert.doesNotMatch(html, new RegExp(EXAMPLE_CLASS));
});

Then('three separate example blocks appear', function (this: LearningWorld) {
  const html = this.resultText as string;
  const count = html.split(`class="${EXAMPLE_CLASS}"`).length - 1;
  assert.equal(count, 3);
});

Then(/^it is rendered as (.+)$/, function (this: LearningWorld, expected: string) {
  const html = this.resultText as string;
  if (expected === 'nested markdown') {
    assert.match(html, new RegExp(EXAMPLE_CLASS));
    assert.doesNotMatch(html, /<pre>/);
  } else if (expected === 'code') {
    assert.match(html, /<pre><code/);
    assert.doesNotMatch(html, new RegExp(EXAMPLE_CLASS));
  } else {
    throw new Error(`未知的期望結果:${expected}`);
  }
});

Then('the learned transition is applied for the displayed card', function (this: LearningWorld) {
  const deck = getOrCreateDeck(this);
  const id = initialCard.get(this);
  assert.ok(id, '沒有記錄到初始卡片');
  assert.ok(deck.learned.has(id), `${id} 應該已標記 learned`);
});

Then('the following unlearned card is shown', function (this: LearningWorld) {
  const deck = getOrCreateDeck(this);
  const id = currentCardId(deck);
  assert.notEqual(id, initialCard.get(this), '應該已經前進到下一張卡');
  if (id !== null) assert.ok(!deck.learned.has(id), '顯示中的卡不該已經是 learned');
});

Then('that card has no learned record', function (this: LearningWorld) {
  const deck = getOrCreateDeck(this);
  const id = initialCard.get(this);
  assert.ok(id, '沒有記錄到初始卡片');
  assert.ok(!deck.learned.has(id), `${id} 不該被標記 learned`);
});
