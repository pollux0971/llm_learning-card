/**
 * T2c-1 驗收 E13(csp 不得為 null)、F17(建置指令把兩個前端建進 frontendDist)。
 * 測試 agent 寫的;實作者不要改。只讀 tauri.conf.json,不建置(建置與產物檢查在 cucumber 的
 * 「The real front ends are loaded」,用 test-support/frontend-dist.ts)。
 */
import { describe, expect, it } from 'vitest';
import { missingCsp, parseCsp } from './test-support/csp.js';
import { beforeBuild, readTauriConf, windowEntries } from './test-support/frontend-dist.js';

describe('content security policy(E13)', () => {
  it('csp is a string, not null', () => {
    const csp = readTauriConf().app?.security?.csp;
    expect(typeof csp, `app.security.csp is ${JSON.stringify(csp)}`).toBe('string');
  });

  it('csp has at least the five directives of the ticket', () => {
    const csp = readTauriConf().app?.security?.csp;
    expect(missingCsp(String(csp))).toEqual([]);
  });

  it('script-src does not allow unsafe-inline or unsafe-eval', () => {
    const map = parseCsp(String(readTauriConf().app?.security?.csp));
    const script = map.get('script-src') ?? map.get('default-src') ?? [];
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
  });

  it('the csp parser reads directives and sources', () => {
    const map = parseCsp("default-src 'self'; img-src 'self' lc: data:;  object-src 'none'");
    expect(map.get('default-src')).toEqual(["'self'"]);
    expect(map.get('img-src')).toEqual(["'self'", 'lc:', 'data:']);
    expect(map.get('object-src')).toEqual(["'none'"]);
    expect(missingCsp("default-src 'self'")).toContain("script-src 不存在");
  });
});

describe('front end build wiring(F17)', () => {
  it('build has a beforeBuildCommand', () => {
    expect(beforeBuild(readTauriConf()), 'build.beforeBuildCommand').toBeDefined();
  });

  it('the teach and test windows each name an html file', () => {
    const entries = windowEntries(readTauriConf());
    const labels = entries.map((e) => e.label).sort();
    expect(labels).toEqual(['teach', 'test']);
    for (const e of entries) expect(e.html, e.label).toMatch(/\.html$/);
  });

  it('frontendDist is a folder, not a dev server URL', () => {
    const dist = readTauriConf().build?.frontendDist;
    expect(dist, 'build.frontendDist').toBeTypeOf('string');
    expect(String(dist)).not.toMatch(/^https?:/);
  });
});
