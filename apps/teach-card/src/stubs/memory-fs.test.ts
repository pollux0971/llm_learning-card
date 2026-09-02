import { describe, it, expect } from 'vitest';
import { MemoryFs } from './memory-fs.js';

describe('MemoryFs', () => {
  it('reads a file that was seeded', async () => {
    const fs = new MemoryFs({ 'cards/security/sec-0001.md': 'hello' });
    await expect(fs.read('cards/security/sec-0001.md')).resolves.toBe('hello');
  });

  it('throws on a missing file', async () => {
    const fs = new MemoryFs();
    await expect(fs.read('cards/security/nope.md')).rejects.toThrow();
  });

  it('rejects paths containing ..', async () => {
    const fs = new MemoryFs();
    await expect(fs.read('../secrets.md')).rejects.toThrow();
    await expect(fs.read('cards/../../secrets.md')).rejects.toThrow();
  });

  it('rejects absolute paths', async () => {
    const fs = new MemoryFs();
    await expect(fs.read('/etc/passwd')).rejects.toThrow();
  });

  it('lists files under a directory', async () => {
    const fs = new MemoryFs({
      'cards/security/sec-0001.md': 'a',
      'cards/security/sec-0002.md': 'b',
      'graph/order-security.json': '[]',
    });
    const listed = await fs.list('cards/security');
    expect(listed.sort()).toEqual(['cards/security/sec-0001.md', 'cards/security/sec-0002.md']);
  });

  it('reports existence', async () => {
    const fs = new MemoryFs({ 'a.md': 'x' });
    await expect(fs.exists('a.md')).resolves.toBe(true);
    await expect(fs.exists('b.md')).resolves.toBe(false);
  });

  it('write then read round-trips', async () => {
    const fs = new MemoryFs();
    await fs.write('state/reviews.json', '{}');
    await expect(fs.read('state/reviews.json')).resolves.toBe('{}');
  });

  it('builds an asset url', () => {
    const fs = new MemoryFs();
    expect(fs.assetUrl('assets/security/diagram.png')).toBe('/fixtures/assets/security/diagram.png');
  });
});
