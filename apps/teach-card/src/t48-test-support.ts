/**
 * T48 的測試共用零件(測試 agent 寫;開發 worker 不改):暫存根找法、PNG 產生、真的指標與鍵盤(連同一個 Chrome 的同一個頁面,
 * 做法同 t46-examples-images-render.test.ts;那份檔是測試檔、不能被 import,所以這裡另放一份)。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, tail]);
}
/** 單色 8 位元 RGB 的 PNG */
export function makePng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      raw[y * stride + 1 + x * 3] = rgb[0];
      raw[y * stride + 2 + x * 3] = rgb[1];
      raw[y * stride + 3 + x * 3] = rgb[2];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const IMAGES: Record<string, { w: number; h: number; rgb: [number, number, number] }> = {
  'assets/t46-ok.png': { w: 120, h: 60, rgb: [200, 40, 40] },
  'assets/t46-tall.png': { w: 60, h: 240, rgb: [40, 40, 200] },
  'assets/同源.png': { w: 40, h: 40, rgb: [40, 160, 40] },
  'assets/sub/t46-b.png': { w: 50, h: 50, rgb: [200, 180, 40] },
  /** 比視窗(360)寬很多:沒有 max-width 就會把卡片撐出去 */
  'assets/t46-wide.png': { w: 1200, h: 60, rgb: [40, 160, 160] },
};


export class RealInput {
  private seq = 0;
  private readonly pending = new Map<number, (m: { error?: { message: string } }) => void>();

  private constructor(private readonly ws: WebSocket) {
    ws.onmessage = (ev: MessageEvent) => {
      const msg = JSON.parse(String(ev.data)) as { id?: number; error?: { message: string } };
      if (msg.id !== undefined) {
        this.pending.get(msg.id)?.(msg);
        this.pending.delete(msg.id);
      }
    };
  }

  static async attach(pageUrl: string): Promise<RealInput> {
    for (const name of readdirSync(tmpdir()).filter((n) => n.startsWith('hud-render-chrome-'))) {
      const portFile = join(tmpdir(), name, 'DevToolsActivePort');
      if (!existsSync(portFile)) continue;
      const port = readFileSync(portFile, 'utf8').split('\n')[0]?.trim();
      if (!port) continue;
      try {
        const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) })).json()) as { type: string; url: string; webSocketDebuggerUrl: string }[];
        const target = list.find((t) => t.type === 'page' && t.url.startsWith(pageUrl));
        if (!target) continue;
        const ws = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise<void>((resolve, reject) => {
          ws.onopen = () => resolve();
          ws.onerror = () => reject(new Error('連不上 DevTools'));
        });
        const input = new RealInput(ws);
        await input.send('Page.bringToFront');
        await input.send('Emulation.setFocusEmulationEnabled', { enabled: true });
        return input;
      } catch {
        /* 別人的(已經結束的)Chrome,換下一個 */
      }
    }
    throw new Error(`找不到開著 ${pageUrl} 的 Chrome(hud-render-chrome-*/DevToolsActivePort)`);
  }

  private send(method: string, params: Record<string, unknown> = {}): Promise<void> {
    this.seq += 1;
    const id = this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve()));
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** 真的指標:移過去、按下、放開(同一個點) */
  async click(x: number, y: number): Promise<void> {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  }

  async key(name: 'Tab' | 'Enter' | 'Space' | 'Escape'): Promise<void> {
    const spec = {
      Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
      Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' },
      Space: { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' },
      Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
    }[name];
    await this.send('Input.dispatchKeyEvent', { type: spec.text ? 'keyDown' : 'rawKeyDown', ...spec });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: spec.key, code: spec.code, windowsVirtualKeyCode: spec.windowsVirtualKeyCode });
  }

  close(): void {
    this.ws.close();
  }
}


/** 起 app 前後比對 os.tmpdir() 底下新的 teach-card-*(要有 learning/),回 learning 目錄 */
export function newLearningRoot(before: Set<string>): string {
  const found = readdirSync(tmpdir()).filter((n) => !before.has(n) && n.startsWith('teach-card-') && existsSync(join(tmpdir(), n, 'learning')));
  if (found.length !== 1) throw new Error(`新的暫存根要剛好一個,找到 ${found.length} 個`);
  return join(tmpdir(), found[0]!, 'learning');
}

export function writeImage(learningDir: string, rel: string, width: number, height: number, rgb: [number, number, number]): void {
  const full = join(learningDir, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, makePng(width, height, rgb));
}
