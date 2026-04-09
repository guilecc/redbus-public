import React, { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

function today(): string { return new Date().toISOString().slice(0, 10); }

function getMonthDays(year: number, month: number): string[] {
  const days: string[] = [];
  const d = new Date(year, month, 1);
  while (d.getMonth() === month) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    days.push(`${yyyy}-${mm}-${dd}`);
    d.setDate(d.getDate() + 1);
  }
  return days;
}

interface MiniCalendarProps {
  selectedDate: string;
  activeDates: Set<string>;
  onSelect: (d: string) => void;
}

export const MiniCalendar: React.FC<MiniCalendarProps> = ({ selectedDate, activeDates, onSelect }) => {
  const [viewDate, setViewDate] = useState(() => {
    // Parse selectedDate carefully to strictly get the correct year and month
    const d = new Date(selectedDate + 'T12:00:00');
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const days = getMonthDays(viewDate.year, viewDate.month);
  const firstDow = new Date(days[0] + 'T12:00:00').getDay();
  const monthLabel = new Date(viewDate.year, viewDate.month).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  const prev = () => setViewDate(v => v.month === 0 ? { year: v.year - 1, month: 11 } : { ...v, month: v.month - 1 });
  const next = () => setViewDate(v => v.month === 11 ? { year: v.year + 1, month: 0 } : { ...v, month: v.month + 1 });

  return (
    <div className="inbox-cal" data-testid="mini-calendar">
      <div className="inbox-cal-header">
        <button onClick={prev} data-testid="cal-prev"><ChevronLeft size={14} /></button>
        <span>{monthLabel}</span>
        <button onClick={next} data-testid="cal-next"><ChevronRight size={14} /></button>
      </div>
      <div className="inbox-cal-grid">
        {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((d, i) => <span key={i} className="inbox-cal-dow">{d}</span>)}
        {Array.from({ length: firstDow }).map((_, i) => <span key={`e${i}`} />)}
        {days.map(d => (
          <button key={d} data-testid={`cal-day-${d}`} className={`inbox-cal-day${d === selectedDate ? ' sel' : ''}${d === today() ? ' today' : ''}${activeDates.has(d) ? ' has-digest' : ''}`}
            onClick={() => onSelect(d)}>
            {parseInt(d.slice(8))}
          </button>
        ))}
      </div>
    </div>
  );
};
