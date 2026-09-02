import { describe, it, expect } from 'vitest';
import { detectSessionType } from './session.js';

describe('detectSessionType', () => {
  it('wayland session type wins regardless of display', () => {
    expect(detectSessionType({ sessionType: 'wayland', display: 'wayland-0' })).toBe('wayland');
  });

  it('x11 session with no display is x11', () => {
    expect(detectSessionType({ sessionType: 'x11', display: undefined })).toBe('x11');
  });

  it('no session but a wayland display set is wayland', () => {
    expect(detectSessionType({ sessionType: undefined, display: 'wayland-0' })).toBe('wayland');
  });

  it('nothing set defaults to x11', () => {
    expect(detectSessionType({ sessionType: undefined, display: undefined })).toBe('x11');
  });
});
