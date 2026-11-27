import { useEffect, useMemo, useState } from 'react';
import { addDays, addMonths, monthMatrix, parseDay, startOfWeek, toDayString } from '@ayatodoist/shared-types';
import { monthNames, weekdayNames } from '@ayatodoist/shared-types';

export interface DateValue {
  date: string | null;
  time: string | null;
}

export interface DatePickerProps {
  value: DateValue;
  onChange: (value: DateValue) => void;
  onClose?: () => void;
  language?: 'ar' | 'en';
  weekStart?: 0 | 6;
  timeFormat?: '12h' | '24h';
  showTime?: boolean;
  /** Optional free-text NLP interpreter ("tomorrow at 3pm"). */
  parseText?: (text: string) => DateValue | null;
  today?: string;
  compact?: boolean;
}

const TIME_PRESETS = ['09:00', '12:00', '15:00', '18:00', '20:00'];

/**
 * Clean-room date/time picker matching the measured Todoist geometry:
 * ~252px wide, 32x28 day cells, quick chips, free-text NLP field.
 */
export function DatePicker({
  value,
  onChange,
  onClose,
  language = 'ar',
  weekStart = 6,
  timeFormat = '24h',
  showTime = true,
  parseText,
  today = toDayString(new Date()),
  compact = false,
}: DatePickerProps) {
  const [monthAnchor, setMonthAnchor] = useState(value.date ?? today);
  const [freeText, setFreeText] = useState('');
  const [freeError, setFreeError] = useState(false);

  useEffect(() => {
    if (value.date) setMonthAnchor(value.date);
  }, [value.date]);

  const matrix = useMemo(() => monthMatrix(monthAnchor, weekStart), [monthAnchor, weekStart]);
  const anchorDate = parseDay(monthAnchor);
  const weekdays = useMemo(() => {
    const base = startOfWeek(today, weekStart);
    return Array.from({ length: 7 }, (_, index) => {
      const day = addDays(base, index);
      return { day, label: weekdayNames[language][parseDay(day).getDay()]!.slice(0, 3) };
    });
  }, [today, weekStart, language]);

  const t = (ar: string, en: string) => (language === 'ar' ? ar : en);
  const setDate = (date: string | null) => onChange({ date, time: date ? value.time : null });

  const quick = [
    { label: t('اليوم', 'Today'), date: today },
    { label: t('غدًا', 'Tomorrow'), date: addDays(today, 1) },
    { label: t('نهاية الأسبوع', 'Next weekend'), date: addDays(today, (6 - parseDay(today).getDay() + 7) % 7 || 7) },
  ];

  const submitFreeText = () => {
    if (!parseText || !freeText.trim()) return;
    const parsed = parseText(freeText.trim());
    if (!parsed?.date && !parsed?.time) {
      setFreeError(true);
      return;
    }
    setFreeError(false);
    onChange({ date: parsed.date ?? value.date ?? today, time: parsed.time ?? value.time });
    setFreeText('');
  };

  return (
    <div className={compact ? 'w-[252px]' : 'w-[268px]'} dir={language === 'ar' ? 'rtl' : 'ltr'}>
      <div className="space-y-1 p-1">
        {quick.map((option) => (
          <button
            key={option.label}
            type="button"
            onClick={() => {
              setDate(option.date);
              onClose?.();
            }}
            className="flex h-8 w-full items-center justify-between rounded-btn px-2 text-[13px] text-ink transition-colors hover:bg-hover"
          >
            <span>{option.label}</span>
            <span className="text-[11px] text-ink-subtle">
              {weekdayNames[language][parseDay(option.date).getDay()]!.slice(0, 3)} · {parseDay(option.date).getDate()} {monthNames[language][parseDay(option.date).getMonth()]}
            </span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            setDate(null);
            onClose?.();
          }}
          className="flex h-8 w-full items-center rounded-btn px-2 text-[13px] text-ink-muted transition-colors hover:bg-hover"
        >
          {t('بدون تاريخ', 'No date')}
        </button>
      </div>

      <div className="flex items-center justify-between px-2 pb-1 pt-2">
        <button
          type="button"
          aria-label={t('الشهر السابق', 'Previous month')}
          onClick={() => setMonthAnchor(addDays(`${anchorDate.getFullYear()}-${`${anchorDate.getMonth() + 1}`.padStart(2, '0')}-01`, -1))}
          className="flex h-6 w-6 items-center justify-center rounded-btn text-ink-muted hover:bg-hover"
        >
          ‹
        </button>
        <span className="text-[12px] font-semibold text-ink">
          {monthNames[language][anchorDate.getMonth()]} {anchorDate.getFullYear()}
        </span>
        <button
          type="button"
          aria-label={t('الشهر التالي', 'Next month')}
          onClick={() => setMonthAnchor(addMonths(`${anchorDate.getFullYear()}-${`${anchorDate.getMonth() + 1}`.padStart(2, '0')}-01`, 1))}
          className="flex h-6 w-6 items-center justify-center rounded-btn text-ink-muted hover:bg-hover"
        >
          ›
        </button>
      </div>

      <div className="grid grid-cols-7 px-2">
        {weekdays.map((weekday) => (
          <span key={weekday.day} className="pb-1 text-center text-[10px] font-medium text-ink-subtle">
            {weekday.label}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5 px-2 pb-2">
        {matrix.map((day) => {
          const date = parseDay(day);
          const inMonth = date.getMonth() === anchorDate.getMonth();
          const isToday = day === today;
          const selected = day === value.date;
          const isFriday = date.getDay() === 5;
          return (
            <button
              key={day}
              type="button"
              onClick={() => setDate(day)}
              className={[
                'mx-auto flex h-7 w-[32.8px] items-center justify-center rounded-full text-[12px] transition-colors',
                selected ? 'bg-accent text-white' : isToday ? 'font-semibold text-accent hover:bg-hover' : 'text-ink hover:bg-hover',
                !inMonth && !selected ? 'opacity-35' : '',
                isFriday && !selected ? 'text-ink-muted' : '',
              ].join(' ')}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>

      {showTime && (
        <div className="border-t border-line px-2 py-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-ink-subtle">{t('الوقت', 'Time')}</span>
            <input
              type="time"
              value={value.time ?? ''}
              onChange={(event) => onChange({ date: value.date ?? today, time: event.target.value || null })}
              className="h-7 flex-1 rounded-btn border border-line bg-canvas px-2 text-[12px] text-ink focus:border-accent focus:outline-none"
              aria-label={t('الوقت', 'Time')}
            />
            <button
              type="button"
              onClick={() => onChange({ date: value.date, time: null })}
              className="text-[11px] text-ink-subtle hover:text-ink"
            >
              {t('مسح', 'Clear')}
            </button>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {TIME_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => onChange({ date: value.date ?? today, time: preset })}
                className="rounded-badge bg-hover px-1.5 py-0.5 text-[10px] text-ink-muted hover:text-ink"
              >
                {timeFormat === '12h'
                  ? (() => {
                      const [h, m] = preset.split(':').map(Number);
                      return `${h! % 12 === 0 ? 12 : h! % 12}:${`${m}`.padStart(2, '0')} ${h! >= 12 ? 'PM' : 'AM'}`;
                    })()
                  : preset}
              </button>
            ))}
          </div>
        </div>
      )}

      {parseText && (
        <div className="border-t border-line p-2">
          <input
            value={freeText}
            onChange={(event) => {
              setFreeText(event.target.value);
              setFreeError(false);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                submitFreeText();
              }
            }}
            placeholder={t('اكتب تاريخًا… مثال: غدًا الساعة 3', 'Type a date… e.g. tomorrow at 3pm')}
            className={`h-8 w-full rounded-btn border bg-canvas px-2 text-[12px] text-ink placeholder:text-ink-subtle focus:outline-none ${
              freeError ? 'border-danger' : 'border-line focus:border-accent'
            }`}
            aria-label={t('تاريخ حر', 'Natural language date')}
          />
        </div>
      )}
    </div>
  );
}
