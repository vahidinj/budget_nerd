import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

// ----------------------------------------------
// Debounce
// ----------------------------------------------
/**
 * Debounce a rapidly changing value. Returns the debounced value only after
 * no changes have occurred for `delay` milliseconds.
 */
export const useDebouncedValue = <T,>(value: T, delay: number) => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return debounced;
};

export interface WindowedResult<T> {
  containerRef: React.RefObject<HTMLDivElement>;
  onScroll: () => void;
  slice: T[];
  offsetY: number;          // pixel offset for top spacer
  startIndex: number;       // first row index represented by slice[0]
  total: number;
  viewportHeight: number;
}

// ----------------------------------------------
// Simple manual virtualization / windowing
// ----------------------------------------------
export const useWindowedRows = <T,>(
  rows: T[],
  rowHeight = 32,
  overscan = 5,
  viewport = 400,
  maxRender = 600,
  minRows = 11
): WindowedResult<T> => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);
  const total = rows.length;

  const onScroll = useCallback(() => {
    if (containerRef.current) setScrollTop(containerRef.current.scrollTop);
  }, []);

  // Effective viewport height: prefer measured height if available, but never below minRows*rowHeight
  const minViewport = rowHeight * Math.max(0, minRows || 0);
  const effectiveViewport = Math.max(measuredHeight ?? viewport, minViewport);

  const { slice, offsetY, startIndex } = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const visibleCount = Math.min(
      Math.ceil(effectiveViewport / rowHeight) + overscan * 2,
      maxRender
    );
    const end = Math.min(total, start + visibleCount);
    const slice = rows.slice(start, end);
    return { slice, offsetY: start * rowHeight, startIndex: start };
  }, [scrollTop, rowHeight, overscan, effectiveViewport, maxRender, rows, total]);

  // ResizeObserver to auto-measure container height (improves responsiveness in flex layouts)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // Initial measure
    const measure = () => {
      const h = el.clientHeight;
      if (h && h !== measuredHeight) setMeasuredHeight(h);
    };
    measure();
    let rafId: number | null = null;
    const ro = new ResizeObserver(() => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(measure);
    });
    try { ro.observe(el); } catch { /* ignore */ }
    return () => { if (rafId) cancelAnimationFrame(rafId); try { ro.disconnect(); } catch { /* ignore */ } };
  }, [containerRef]);

  return { containerRef, onScroll, slice, offsetY, startIndex, total, viewportHeight: effectiveViewport };
};

// ----------------------------------------------
// Polling
// ----------------------------------------------
interface PollingController {
  trigger: () => void;       // manually invoke immediately and reschedule
  stop: () => void;          // pause further polling
  running: boolean;          // whether an async invocation is in flight
}

export const usePolling = (
  fn: () => void | Promise<void>,
  intervalMs: number,
  immediate = true
): PollingController => {
  const saved = useRef(fn);
  const timerRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const stoppedRef = useRef(false);
  const [, force] = useState(0); // force rerenders to expose running state

  useEffect(() => { saved.current = fn; }, [fn]);

  const clear = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const schedule = useCallback(() => {
    clear();
    if (stoppedRef.current) return;
    timerRef.current = window.setTimeout(async () => {
      if (stoppedRef.current) return;
      runningRef.current = true; force(x => x + 1);
      try { await saved.current(); } catch { /* swallow */ }
      runningRef.current = false; force(x => x + 1);
      schedule();
    }, intervalMs);
  }, [intervalMs]);

  const trigger = useCallback(() => {
    stoppedRef.current = false;
    runningRef.current = true; force(x => x + 1);
    Promise.resolve(saved.current()).finally(() => {
      runningRef.current = false; force(x => x + 1);
      schedule();
    });
  }, [schedule]);

  const stop = useCallback(() => {
    stoppedRef.current = true;
    clear();
  }, []);

  useEffect(() => {
    stoppedRef.current = false;
    if (immediate) trigger(); else schedule();
    return () => { stoppedRef.current = true; clear(); };
  }, [immediate, trigger, schedule]);

  return { trigger, stop, running: runningRef.current };
};
