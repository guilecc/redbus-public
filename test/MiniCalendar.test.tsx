import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import { MiniCalendar } from '../src/components/Layout/MiniCalendar';

describe('MiniCalendar', () => {
  it('renders correctly with given selectedDate', () => {
    const selectedDate = '2026-03-19';
    const activeDates = new Set(['2026-03-18', '2026-03-19']);
    const onSelect = vi.fn();

    render(
      <MiniCalendar
        selectedDate={selectedDate}
        activeDates={activeDates}
        onSelect={onSelect}
      />
    );

    // Verify grid headers
    expect(screen.getByText('março de 2026')).toBeInTheDocument();
    
    // Verify specific day exists
    const dayBtn = screen.getByTestId('cal-day-2026-03-19');
    expect(dayBtn).toBeInTheDocument();
  });

  it('calls onSelect when a day is clicked', () => {
    const selectedDate = '2026-03-19';
    const activeDates = new Set<string>();
    const onSelect = vi.fn();

    render(
      <MiniCalendar
        selectedDate={selectedDate}
        activeDates={activeDates}
        onSelect={onSelect}
      />
    );

    const dayBtn = screen.getByTestId('cal-day-2026-03-10');
    fireEvent.click(dayBtn);

    expect(onSelect).toHaveBeenCalledWith('2026-03-10');
  });

  it('navigates to next and previous months', () => {
    const selectedDate = '2026-03-15';
    const activeDates = new Set<string>();
    const onSelect = vi.fn();

    render(
      <MiniCalendar
        selectedDate={selectedDate}
        activeDates={activeDates}
        onSelect={onSelect}
      />
    );

    // Previous Month
    const prevBtn = screen.getByTestId('cal-prev');
    fireEvent.click(prevBtn);
    expect(screen.getByText('fevereiro de 2026')).toBeInTheDocument();

    // Next Month x 2
    const nextBtn = screen.getByTestId('cal-next');
    fireEvent.click(nextBtn);
    fireEvent.click(nextBtn);
    expect(screen.getByText('abril de 2026')).toBeInTheDocument();
  });
});
