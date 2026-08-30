export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

type Weekday = typeof WEEKDAYS[number];
export type BuilderMode = 'every' | 'daily' | 'weekly';
export type ScheduleMode = BuilderMode | 'advanced';

export type ScheduleBuilder =
  | { mode: 'every'; amount: number; unit: 'm' | 'h' }
  | { mode: 'daily'; time: string }
  | { mode: 'weekly'; day: Weekday; time: string };

const timeValue = (hour: string, minute: string): string =>
  `${String(Number(hour)).padStart(2, '0')}:${minute}`;

export function parseBuilderSchedule(value: string): ScheduleBuilder | null {
  const text = String(value ?? '').trim();
  let match = /^every\s+(\d+)\s*(m|h)$/i.exec(text);
  if (match) {
    const amount = Number(match[1]);
    if (Number.isSafeInteger(amount) && amount >= 1) {
      return { mode: 'every', amount, unit: match[2]!.toLowerCase() as 'm' | 'h' };
    }
    return null;
  }
  match = /^daily\s+([01]?\d|2[0-3]):([0-5]\d)$/i.exec(text);
  if (match) return { mode: 'daily', time: timeValue(match[1]!, match[2]!) };
  match = /^weekly\s+(sun|mon|tue|wed|thu|fri|sat)\s+([01]?\d|2[0-3]):([0-5]\d)$/i.exec(text);
  if (match) {
    return {
      mode: 'weekly',
      day: match[1]!.toLowerCase() as Weekday,
      time: timeValue(match[2]!, match[3]!),
    };
  }
  return null;
}

export function renderBuilderSchedule(builder: ScheduleBuilder): string {
  if (builder.mode === 'every') return `every ${builder.amount}${builder.unit}`;
  if (builder.mode === 'daily') return `daily ${builder.time}`;
  return `weekly ${builder.day} ${builder.time}`;
}

export function builderForMode(mode: BuilderMode, current: ScheduleBuilder | null): ScheduleBuilder {
  if (current?.mode === mode) return current;
  if (mode === 'every') return { mode, amount: 1, unit: 'h' };
  const time = current && current.mode !== 'every' ? current.time : '06:00';
  if (mode === 'daily') return { mode, time };
  return { mode, day: current?.mode === 'weekly' ? current.day : 'mon', time };
}

export interface ActiveHours {
  start: number;
  end: number;
}

export function parseActiveHours(value: string | undefined): ActiveHours | null {
  if (!value) return null;
  const match = /^([01]?\d|2[0-3])\s*-\s*([01]?\d|2[0-3])$/.exec(value.trim());
  return match ? { start: Number(match[1]), end: Number(match[2]) } : null;
}

export function renderActiveHours(start: number, end: number): string | null {
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  if (start < 0 || start > 23 || end < 0 || end > 23) return null;
  return `${start}-${end}`;
}
