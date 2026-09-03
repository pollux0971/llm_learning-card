import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './init.js';
import { validateCategory, validateSettings } from './validate-config.js';

describe('validateCategory', () => {
  it('passes a well formed category', () => {
    const result = validateCategory({ id: 'security', name: 'Security', require_raw: true });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('fails when require_raw is missing', () => {
    const result = validateCategory({ id: 'security', name: 'Security' });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.startsWith('require_raw'))).toBe(true);
  });

  it('fails when id is missing', () => {
    const result = validateCategory({ name: 'Security', require_raw: true });
    expect(result.ok).toBe(false);
  });

  it('fails when name is empty', () => {
    const result = validateCategory({ id: 'security', name: '', require_raw: true });
    expect(result.ok).toBe(false);
  });

  it('fails when id contains a path separator', () => {
    const result = validateCategory({ id: 'a/b', name: 'x', require_raw: true });
    expect(result.ok).toBe(false);
  });

  it('rejects a non-object input', () => {
    const result = validateCategory(null);
    expect(result.ok).toBe(false);
  });
});

describe('validateSettings', () => {
  it('passes the contract defaults', () => {
    const result = validateSettings(DEFAULT_SETTINGS);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it.each([0, -3])('fails when daily_cap is %i', (daily_cap) => {
    const result = validateSettings({ ...DEFAULT_SETTINGS, daily_cap });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.startsWith('daily_cap'))).toBe(true);
  });

  it.each([0, 1.5])('fails when weekly_target is %s', (weekly_target) => {
    const result = validateSettings({ ...DEFAULT_SETTINGS, weekly_target });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.startsWith('weekly_target'))).toBe(true);
  });

  it('fails when short_body_limit is not positive', () => {
    const result = validateSettings({ ...DEFAULT_SETTINGS, short_body_limit: 0 });
    expect(result.ok).toBe(false);
  });

  it('fails when llm.cloud_provider is not a known provider', () => {
    const result = validateSettings({
      ...DEFAULT_SETTINGS,
      llm: { ...DEFAULT_SETTINGS.llm, cloud_provider: 'gemini' },
    });
    expect(result.ok).toBe(false);
  });

  it('fails when llm.cloud_model is empty', () => {
    const result = validateSettings({ ...DEFAULT_SETTINGS, llm: { ...DEFAULT_SETTINGS.llm, cloud_model: '' } });
    expect(result.ok).toBe(false);
  });

  it('fails when llm.local_model is missing', () => {
    const { local_model: _drop, ...rest } = DEFAULT_SETTINGS.llm;
    const result = validateSettings({ ...DEFAULT_SETTINGS, llm: rest });
    expect(result.ok).toBe(false);
  });

  it('accepts openai as the cloud provider', () => {
    const result = validateSettings({ ...DEFAULT_SETTINGS, llm: { ...DEFAULT_SETTINGS.llm, cloud_provider: 'openai' } });
    expect(result.ok).toBe(true);
  });

  it('rejects a non-object input', () => {
    const result = validateSettings(null);
    expect(result.ok).toBe(false);
  });
});
