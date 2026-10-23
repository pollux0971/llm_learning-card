/**
 * 教學卡視窗邏輯(ADR-077、ADR-078)。判斷與寫入在側車;這裡只帶參數、收結果、記住類別。
 * 重試在共用的 ReviewClient。不碰 node:。用桌面殼的 ReviewClient 與 LearningFs,不另寫一份。
 */
import type { LearningFs } from '../../desktop/src/webview/learning-fs.js';
import { reviewErrorText, type ReviewClient } from '../../desktop/src/webview/review-client.js';

export const LAST_CATEGORY_KEY = 'lc-teach-last-category';
export const BUSY_MESSAGE = '考試卡還在用複習程式,稍等一下。';
export const FINISHED_MESSAGE = '這個類別已經學完了。可以考慮補充更多素材。';

export interface TeachSessionDeps {
  client: Pick<ReviewClient, 'teachOpen' | 'teachNext' | 'teachSwitch' | 'teachPrereq' | 'onWait'>;
  fs: Pick<LearningFs, 'read'>;
  storage: { getItem(key: string): string | null; setItem(key: string, value: string): void };
}

interface ServerCard {
  id: string;
  path: string;
  title: string;
}

interface ServerRow {
  id: string;
  name: string;
  remaining: number;
  requireRaw: boolean;
}

interface ServerView {
  category: string;
  categories: ServerRow[];
  card: ServerCard | null;
  prereqs: { id: string; title: string }[];
}

export interface TeachView {
  state: 'loading' | 'card' | 'finished' | 'categories' | 'error';
  category: string | undefined;
  card: ServerCard | undefined;
  cardText: string | undefined;
  prereqs: { id: string; title: string }[];
  categories: { id: string; label: string; current: boolean }[];
  canNext: boolean;
  waiting: boolean;
  busyNotice: string | undefined;
  controlsDisabled: boolean;
  message: string | undefined;
  canRetry: boolean;
}

type Mode = 'loading' | 'card' | 'finished' | 'categories' | 'error';
type Beneath = 'card' | 'finished';

type Pending =
  | { kind: 'open'; category: string | undefined }
  | { kind: 'next' }
  | { kind: 'switch'; category: string }
  | { kind: 'prereq'; index: number };

function categoryLabel(row: ServerRow, current: boolean): string {
  const count = row.remaining === 0 ? '學完了' : `剩 ${row.remaining} 張`;
  const body = row.requireRaw ? `${row.name} · 需要素材 · ${count}` : `${row.name} · ${count}`;
  return current ? `${body} (目前)` : body;
}

export function createTeachSession(deps: TeachSessionDeps): {
  view(): TeachView;
  open(): Promise<void>;
  next(): Promise<void>;
  openCategories(): void;
  cancelCategories(): void;
  chooseCategory(id: string): Promise<void>;
  followPrereq(index: number): Promise<void>;
  retry(): Promise<void>;
  categoryNameOf(id: string): string;
} {
  let mode: Mode = 'loading';
  let beneath: Beneath = 'card';
  let category: string | undefined;
  let card: ServerCard | undefined;
  let cardText: string | undefined;
  let prereqs: { id: string; title: string }[] = [];
  let rows: ServerRow[] = [];
  let waiting = false;
  let inFlight = false;
  let controlsDisabled = false;
  let message: string | undefined;
  let pending: Pending | undefined;

  deps.client.onWait((isWaiting) => {
    waiting = isWaiting;
    controlsDisabled = isWaiting || inFlight;
  });

  function labels(): { id: string; label: string; current: boolean }[] {
    return rows.map((row) => ({
      id: row.id,
      current: row.id === category,
      label: categoryLabel(row, row.id === category),
    }));
  }

  function view(): TeachView {
    const showingCard = mode === 'card' || mode === 'categories';
    return {
      state: mode,
      category,
      card: mode === 'finished' || mode === 'loading' ? undefined : card,
      cardText: showingCard ? cardText : undefined,
      prereqs,
      categories: labels(),
      canNext: mode === 'card',
      waiting,
      busyNotice: waiting ? BUSY_MESSAGE : undefined,
      controlsDisabled,
      message: mode === 'finished' ? FINISHED_MESSAGE : mode === 'error' ? message : undefined,
      canRetry: mode === 'error',
    };
  }

  function clearBusy(): void {
    waiting = false;
    controlsDisabled = false;
  }

  function showError(text: string): void {
    clearBusy();
    mode = 'error';
    message = text;
  }

  async function apply(raw: ServerView): Promise<void> {
    category = raw.category;
    rows = raw.categories;
    prereqs = raw.prereqs;
    deps.storage.setItem(LAST_CATEGORY_KEY, raw.category);
    clearBusy();
    message = undefined;
    if (raw.card === null) {
      card = undefined;
      cardText = undefined;
      beneath = 'finished';
      mode = 'finished';
      return;
    }
    card = raw.card;
    cardText = await deps.fs.read(raw.card.path);
    beneath = 'card';
    mode = 'card';
  }

  async function invoke(action: Pending): Promise<ServerView> {
    if (action.kind === 'open') {
      const raw = action.category === undefined ? await deps.client.teachOpen() : await deps.client.teachOpen(action.category);
      return raw as unknown as ServerView;
    }
    if (action.kind === 'next') return (await deps.client.teachNext()) as unknown as ServerView;
    if (action.kind === 'switch') return (await deps.client.teachSwitch(action.category)) as unknown as ServerView;
    return (await deps.client.teachPrereq(action.index)) as unknown as ServerView;
  }

  async function run(action: Pending): Promise<void> {
    pending = action;
    inFlight = true;
    controlsDisabled = true;
    try {
      await apply(await invoke(action));
    } catch (err) {
      showError(reviewErrorText(err));
    } finally {
      inFlight = false;
      waiting = false;
      controlsDisabled = false;
    }
  }

  function restoreList(): void {
    mode = beneath;
    message = undefined;
  }

  function categoryNameOf(id: string): string {
    const row = rows.find((item) => item.id === id);
    return row === undefined ? id : row.name;
  }

  return {
    view,
    open: () => {
      const stored = deps.storage.getItem(LAST_CATEGORY_KEY);
      return run({ kind: 'open', category: stored === null ? undefined : stored });
    },
    next: () => run({ kind: 'next' }),
    openCategories: () => {
      mode = 'categories';
    },
    cancelCategories: () => {
      restoreList();
    },
    chooseCategory: (id: string) => {
      if (id === category) {
        restoreList();
        return Promise.resolve();
      }
      return run({ kind: 'switch', category: id });
    },
    followPrereq: (index: number) => run({ kind: 'prereq', index }),
    retry: () => (pending === undefined ? Promise.resolve() : run(pending)),
    categoryNameOf,
  };
}
