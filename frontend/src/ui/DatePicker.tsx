import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

interface DatePickerProps {
  label?: string; // optional visual label (we already wrap in parent label with .lbl text)
  value: string; // YYYY-MM-DD or ''
  onChange: (val: string) => void;
  min?: string;
  max?: string;
  ariaLabel?: string;
}

// Utility to format to YYYY-MM-DD
function fmt(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const WEEKDAYS = ['Su','Mo','Tu','We','Th','Fr','Sa'];

export const DatePicker: React.FC<DatePickerProps> = ({ value, onChange, min, max, ariaLabel }) => {
  const parsed = value ? new Date(value + 'T00:00:00') : new Date();
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(parsed.getFullYear());
  const [viewMonth, setViewMonth] = useState(parsed.getMonth()); // 0-based
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const [popPos, setPopPos] = useState<{ top: number; left: number; width: number } | null>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      const insideWrapper = wrapperRef.current?.contains(t);
      const insidePop = gridRef.current?.contains(t);
      if (!insideWrapper && !insidePop) setOpen(false);
    };
    if(open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Position popover relative to button using fixed coords
  useEffect(() => {
    if (!open) return;
    const compute = () => {
      const btn = btnRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const top = r.bottom + 6; // matches CSS gap
      let left = r.left;
      const width = 250; // calendar width
      const vw = window.innerWidth;
      if (left + width > vw - 8) left = Math.max(8, vw - width - 8);
      setPopPos({ top, left, width });
    };
    compute();
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    return () => { window.removeEventListener('resize', compute); window.removeEventListener('scroll', compute, true); };
  }, [open]);

  useEffect(() => {
    if(!open) return;
    const handler = (e: KeyboardEvent) => {
      if(e.key === 'Escape'){ setOpen(false); return; }
      if(!value) return; // navigation relative to selected date
      const base = new Date(value + 'T00:00:00');
      if(e.key === 'ArrowLeft'){ base.setDate(base.getDate()-1); onChange(fmt(base)); e.preventDefault(); }
      else if(e.key === 'ArrowRight'){ base.setDate(base.getDate()+1); onChange(fmt(base)); e.preventDefault(); }
      else if(e.key === 'ArrowUp'){ base.setDate(base.getDate()-7); onChange(fmt(base)); e.preventDefault(); }
      else if(e.key === 'ArrowDown'){ base.setDate(base.getDate()+7); onChange(fmt(base)); e.preventDefault(); }
      else if(e.key === 'PageUp'){ base.setMonth(base.getMonth()-1); onChange(fmt(base)); setViewMonth(base.getMonth()); setViewYear(base.getFullYear()); e.preventDefault(); }
      else if(e.key === 'PageDown'){ base.setMonth(base.getMonth()+1); onChange(fmt(base)); setViewMonth(base.getMonth()); setViewYear(base.getFullYear()); e.preventDefault(); }
      else if(e.key === 'Home'){ base.setDate(1); onChange(fmt(base)); setViewMonth(base.getMonth()); setViewYear(base.getFullYear()); e.preventDefault(); }
      else if(e.key === 'End'){ base.setMonth(base.getMonth()+1); base.setDate(0); onChange(fmt(base)); setViewMonth(base.getMonth()); setViewYear(base.getFullYear()); e.preventDefault(); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, value, onChange]);

  // Build calendar grid days
  const days: { date: Date; inMonth: boolean; disabled: boolean }[] = [];
  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const startWeekday = firstOfMonth.getDay();
  // Previous month days to fill first row
  for(let i = 0; i < startWeekday; i++) {
    const d = new Date(viewYear, viewMonth, 1 - (startWeekday - i));
    days.push({ date: d, inMonth: false, disabled: false });
  }
  // Days of current month
  const lastOfMonth = new Date(viewYear, viewMonth + 1, 0);
  for(let day = 1; day <= lastOfMonth.getDate(); day++) {
    const d = new Date(viewYear, viewMonth, day);
    let disabled = false;
    if(min && d < new Date(min + 'T00:00:00')) disabled = true;
    if(max && d > new Date(max + 'T23:59:59')) disabled = true;
    days.push({ date: d, inMonth: true, disabled });
  }
  // Next month filler to complete 6 rows (42 cells) for stable layout
  while(days.length < 42) {
    const last = days[days.length - 1].date;
    const d = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
    days.push({ date: d, inMonth: false, disabled: false });
  }

  const currentStr = value ? value : '';

  const selectDay = useCallback((d: Date, disabled: boolean) => {
    if(disabled) return;
    onChange(fmt(d));
    setViewMonth(d.getMonth());
    setViewYear(d.getFullYear());
  }, [onChange]);

  const moveMonth = (delta: number) => {
    const target = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(target.getFullYear());
    setViewMonth(target.getMonth());
  };

  const monthLabel = new Date(viewYear, viewMonth, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });

  return (
    <div className={"date-picker" + (open ? " open" : "")} ref={wrapperRef}>
      <button ref={btnRef} type="button" className="date-picker-display" aria-haspopup="dialog" aria-expanded={open} onClick={()=> setOpen(o=> !o)} aria-label={ariaLabel || 'Choose date'}>
        {currentStr || '—'}
        <span className="dp-caret" aria-hidden="true">▾</span>
      </button>
      {open && popPos && createPortal(
        <div
          className="date-pop"
          role="dialog"
          aria-label="Calendar"
          ref={gridRef}
          style={{ position:'fixed', top: popPos.top, left: popPos.left, width: popPos.width, zIndex: 5000 }}
        >
          <div className="date-pop-head">
            <button type="button" onClick={()=> moveMonth(-1)} aria-label="Previous month" className="nav-btn">‹</button>
            <div className="month-label">{monthLabel}</div>
            <button type="button" onClick={()=> moveMonth(1)} aria-label="Next month" className="nav-btn">›</button>
          </div>
          <div className="weekdays" aria-hidden="true">
            {WEEKDAYS.map(d=> <div key={d}>{d}</div>)}
          </div>
          <div className="days-grid">
            {days.map(({date,inMonth,disabled}) => {
              const ds = fmt(date);
              const isSelected = currentStr === ds;
              return (
                <button
                  key={ds}
                  type="button"
                  className={
                    'day-cell' +
                    (inMonth ? '' : ' dim') +
                    (isSelected ? ' selected' : '') +
                    (disabled ? ' disabled' : '')
                  }
                  onClick={()=> { selectDay(date, disabled); }}
                  disabled={disabled}
                  aria-pressed={isSelected}
                  aria-label={ds + (disabled ? ' unavailable' : '')}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>
          <div className="date-pop-foot">
            <button type="button" className="today-btn" onClick={()=> { const now = new Date(); onChange(fmt(now)); setViewYear(now.getFullYear()); setViewMonth(now.getMonth()); }}>Today</button>
            <button type="button" className="clear-btn" onClick={()=> onChange('')}>Clear</button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
