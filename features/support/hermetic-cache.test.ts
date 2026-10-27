/**
 * T64 單元測試:installHermeticCache / restore。傳假的 env 物件,不碰真的 process.env。測試 agent 寫;開發 worker 不改。
 */
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { installHermeticCache } from './hermetic-cache.js';

const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});
const install = (env: NodeJS.ProcessEnv) => {
  const h = installHermeticCache(env);
  made.push(h.dir);
  return h;
};

describe('installHermeticCache', () => {
  it('原本沒設:裝上後指到新建的目錄', () => {
    const env: NodeJS.ProcessEnv = {};
    const h = install(env);
    expect(env['XDG_CACHE_HOME']).toBe(h.dir);
    expect(existsSync(h.dir)).toBe(true);
  });

  it('原本沒設:還原後鍵不見(不是字串 undefined),目錄也沒了', () => {
    const env: NodeJS.ProcessEnv = { OTHER: 'x' };
    const h = install(env);
    h.restore();
    expect('XDG_CACHE_HOME' in env).toBe(false);
    expect(Object.keys(env)).toEqual(['OTHER']);
    expect(existsSync(h.dir)).toBe(false);
  });

  it('原本有值:還原後是原本那個值', () => {
    const env: NodeJS.ProcessEnv = { XDG_CACHE_HOME: '/some/real/cache' };
    const h = install(env);
    expect(env['XDG_CACHE_HOME']).toBe(h.dir);
    expect(h.dir).not.toBe('/some/real/cache');
    h.restore();
    expect(env['XDG_CACHE_HOME']).toBe('/some/real/cache');
  });

  it('原本是空字串:還原後仍是空字串(不是被刪掉)', () => {
    const env: NodeJS.ProcessEnv = { XDG_CACHE_HOME: '' };
    const h = install(env);
    h.restore();
    expect(Object.prototype.hasOwnProperty.call(env, 'XDG_CACHE_HOME')).toBe(true);
    expect(env['XDG_CACHE_HOME']).toBe('');
  });

  it('新目錄在 os.tmpdir() 底下、名字以 lc-cucumber-cache- 開頭', () => {
    const h = install({});
    const rel = relative(tmpdir(), h.dir);
    expect(rel.startsWith('..')).toBe(false);
    expect(rel.split(sep)).toHaveLength(1);
    expect(rel.startsWith('lc-cucumber-cache-')).toBe(true);
  });

  it('每次呼叫都是不同的目錄', () => {
    const a = install({});
    const b = install({});
    expect(a.dir).not.toBe(b.dir);
  });

  it('還原會連目錄裡的檔一起刪', () => {
    const h = install({});
    writeFileSync(join(h.dir, 'x.json'), '{}');
    h.restore();
    expect(existsSync(h.dir)).toBe(false);
  });

  it('目錄已被別人刪掉時 restore 不丟錯,仍還原環境變數', () => {
    const env: NodeJS.ProcessEnv = { XDG_CACHE_HOME: '/keep' };
    const h = install(env);
    rmSync(h.dir, { recursive: true, force: true });
    expect(() => h.restore()).not.toThrow();
    expect(env['XDG_CACHE_HOME']).toBe('/keep');
  });

  it('restore 呼叫兩次無害:第二次不會把別人後來設的值蓋掉', () => {
    const env: NodeJS.ProcessEnv = {};
    const h = install(env);
    h.restore();
    env['XDG_CACHE_HOME'] = '/later';
    h.restore();
    expect(env['XDG_CACHE_HOME']).toBe('/later');
  });

  it('不動別的環境變數(XDG_CONFIG_HOME、HOME)', () => {
    const env: NodeJS.ProcessEnv = { XDG_CONFIG_HOME: '/c', HOME: '/h' };
    const h = install(env);
    expect(env['XDG_CONFIG_HOME']).toBe('/c');
    expect(env['HOME']).toBe('/h');
    h.restore();
    expect(env).toEqual({ XDG_CONFIG_HOME: '/c', HOME: '/h' });
  });

  it('不給 env 時用真的 process.env,restore 後原樣還回去', () => {
    const before = Object.prototype.hasOwnProperty.call(process.env, 'XDG_CACHE_HOME') ? process.env['XDG_CACHE_HOME'] : Symbol.for('unset');
    const h = installHermeticCache();
    made.push(h.dir);
    try {
      expect(process.env['XDG_CACHE_HOME']).toBe(h.dir);
    } finally {
      h.restore();
    }
    const after = Object.prototype.hasOwnProperty.call(process.env, 'XDG_CACHE_HOME') ? process.env['XDG_CACHE_HOME'] : Symbol.for('unset');
    expect(after).toBe(before);
  });
});

