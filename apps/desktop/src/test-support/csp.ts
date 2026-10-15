/**
 * Content-Security-Policy 字串 → 指令表(T2c-1 驗收 E13;測試 agent 寫的)。
 * `default-src 'self'; img-src 'self' lc: data:` → Map { 'default-src' => ["'self'"], 'img-src' => ["'self'", 'lc:', 'data:'] }
 */
export function parseCsp(csp: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const part of csp.split(';')) {
    const tokens = part.trim().split(/\s+/).filter((t) => t.length > 0);
    const [name, ...sources] = tokens;
    if (!name) continue;
    const key = name.toLowerCase();
    if (!out.has(key)) out.set(key, sources);
  }
  return out;
}

/** 驗收 E13 的最低要求:每個指令至少要有這些來源。 */
export const REQUIRED_CSP: Record<string, string[]> = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'object-src': ["'none'"],
  'frame-src': ["'none'"],
  'img-src': ["'self'", 'lc:', 'data:'],
};

/** 回傳缺的部分;空 = 符合。 */
export function missingCsp(csp: string): string[] {
  const map = parseCsp(csp);
  const missing: string[] = [];
  for (const [directive, sources] of Object.entries(REQUIRED_CSP)) {
    const have = map.get(directive);
    if (!have) {
      missing.push(`${directive} 不存在`);
      continue;
    }
    for (const s of sources) if (!have.includes(s)) missing.push(`${directive} 缺 ${s}`);
  }
  return missing;
}
