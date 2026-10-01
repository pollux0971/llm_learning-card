import { MemoryFs as TestFs } from '/data/python/llm_learning-cards/apps/test-card/src/stubs/memory-fs.ts';
import { MemoryFs as TeachFs } from '/data/python/llm_learning-cards/apps/teach-card/src/stubs/memory-fs.ts';
const inputs = [
  '../../etc/passwd','cards/../../../etc/passwd','/etc/passwd','cards/./../../secret','..%2f..%2fetc%2fpasswd',
  '..%2F..%2Fetc%2Fpasswd','%2e%2e/%2e%2e/etc/passwd','..%252f..%252fetc','..\\..\\etc\\passwd','cards\\..\\..\\secret',
  'C:\\Windows\\win.ini','C:/Windows/win.ini','\\\\server\\share\\x','\\etc\\passwd','//etc/passwd',
  'cards/../state/reviews.json','./cards/a.md','cards//a.md','cards/a.md\u0000.png','~/secret','..',' ../x','file:///etc/passwd',
  'cards/security/sec-0042.md','state/reviews.json','assets/sec-0042-diagram.png',
];
async function probe(name: string, mk: () => any) {
  for (const p of inputs) {
    const fs = mk();
    let r: string;
    try { await fs.write(p, 'x'); r = 'ACCEPT'; } catch (e: any) { r = 'REJECT'; }
    let key = '';
    try { key = JSON.stringify([...(fs as any).files.keys()][0] ?? ''); } catch {}
    console.log(`${name}\t${r}\t${JSON.stringify(p)}\tstored=${key}`);
  }
}
await probe('test-card', () => new TestFs());
await probe('teach-card', () => new TeachFs());
