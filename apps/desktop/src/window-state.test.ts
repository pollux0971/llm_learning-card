import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultLayout, saveWindowState, loadWindowState } from './window-state.js';

describe('window state persistence', () => {
  let dir: string;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('loads the default layout when no state file exists yet', async () => {
    dir = await mkdtemp(join(tmpdir(), 'lc-window-state-'));
    const loaded = await loadWindowState(join(dir, 'window-state.json'));
    expect(loaded).toEqual(defaultLayout());
  });

  it('restores exactly what was saved, both windows independently', async () => {
    dir = await mkdtemp(join(tmpdir(), 'lc-window-state-'));
    const file = join(dir, 'window-state.json');
    const moved = {
      teach: { x: 42, y: 7, width: 500, height: 600 },
      test: { x: 900, y: 300, width: 320, height: 400 },
    };

    await saveWindowState(file, moved);
    const loaded = await loadWindowState(file);

    expect(loaded).toEqual(moved);
  });
});
