import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDebouncedValue, useWindowedRows, usePolling } from './hooks';

// Polyfill requestAnimationFrame for ResizeObserver callback path
if (!global.requestAnimationFrame) {
  // @ts-ignore
  global.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(()=>cb(performance.now()), 16) as any;
}

// Basic fake ResizeObserver for tests
class RO {
  // @ts-ignore
  constructor(cb) { this.cb = cb; }
  observe() { /* no-op */ }
  disconnect() { /* no-op */ }
}
// @ts-ignore
global.ResizeObserver = RO;

describe('useDebouncedValue', () => {
  it('debounces updates', async () => {
    vi.useFakeTimers();
    interface Props { val: string }
    const { result, rerender } = renderHook((p: Props) => useDebouncedValue(p.val, 200), { initialProps: { val: 'a' } });
    expect(result.current).toBe('a');
    rerender({ val: 'b' });
    // still old value before timer
    expect(result.current).toBe('a');
    act(() => { vi.advanceTimersByTime(199); });
    expect(result.current).toBe('a');
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toBe('b');
    vi.useRealTimers();
  });
});

describe('useWindowedRows', () => {
  it('returns a slice within bounds', () => {
    const rows = Array.from({ length: 1000 }, (_, i) => i);
    const { result } = renderHook(() => useWindowedRows(rows, 20, 2, 200, 100));
    // viewport ~200 with rowHeight 20 => ~10 rows + overscan 4 => <=14
    expect(result.current.slice.length).toBeLessThanOrEqual(20);
    expect(result.current.total).toBe(1000);
  });
});

describe('usePolling', () => {
  it('schedules repeated calls and supports manual trigger/stop', async () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const { result } = renderHook(() => usePolling(fn, 500, false));
    // Initially no call since immediate=false
    expect(fn).not.toHaveBeenCalled();
    // Advance just shy of interval
    act(() => { vi.advanceTimersByTime(499); });
    expect(fn).not.toHaveBeenCalled();
    // Hit interval -> first scheduled run
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(fn).toHaveBeenCalledTimes(1);
    // Manual trigger should invoke immediately and reschedule
    act(() => { result.current.trigger(); });
    expect(fn).toHaveBeenCalledTimes(2);
    // Advance another interval for scheduled run after trigger
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(fn).toHaveBeenCalledTimes(3);
    // Stopping prevents further scheduling
    act(() => { result.current.stop(); });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(fn).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });
});
