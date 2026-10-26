export type PresenceWindow = { day: number; start: string; end: string };
const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
export const minutes = (time: string) =>
  Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

export function parseSchedule(value: unknown): PresenceWindow[] {
  if (!Array.isArray(value) || value.length > 28)
    throw new Error('Le planning doit contenir au maximum 28 plages horaires.');
  const entries = value
    .map((entry: PresenceWindow) => {
      if (
        !entry ||
        !Number.isInteger(entry.day) ||
        entry.day < 1 ||
        entry.day > 7 ||
        typeof entry.start !== 'string' ||
        typeof entry.end !== 'string' ||
        !timePattern.test(entry.start) ||
        !timePattern.test(entry.end) ||
        minutes(entry.start) >= minutes(entry.end)
      )
        throw new Error(
          'Chaque plage doit préciser un jour et des heures de début et de fin valides.',
        );
      return { day: entry.day, start: entry.start, end: entry.end };
    })
    .sort((a, b) => a.day - b.day || minutes(a.start) - minutes(b.start));
  for (let i = 1; i < entries.length; i++)
    if (overlap(entries[i - 1], entries[i]))
      throw new Error('Les plages de présence ne doivent pas se chevaucher.');
  return entries;
}

export function overlap(a: PresenceWindow, b: PresenceWindow) {
  return (
    a.day === b.day &&
    minutes(a.start) < minutes(b.end) &&
    minutes(b.start) < minutes(a.end)
  );
}

export function parisTime(date: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  return {
    day: dayNames.indexOf(get('weekday')) + 1,
    minute: Number(get('hour')) * 60 + Number(get('minute')),
    date: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

export function covers(schedule: PresenceWindow[], start: Date, end: Date) {
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    end <= start
  )
    return false;
  const a = parisTime(start);
  const b = parisTime(end);
  return (
    a.date === b.date &&
    schedule.some(
      (w) =>
        w.day === a.day &&
        start >= parisDate(a.date, minutes(w.start)) &&
        end <= parisDate(a.date, minutes(w.end)),
    )
  );
}

export function currentPresence(schedule: PresenceWindow[], at = new Date()) {
  const time = parisTime(at);
  return schedule.some(
    (w) =>
      w.day === time.day &&
      minutes(w.start) <= time.minute &&
      time.minute < minutes(w.end),
  );
}

// Converts a local Paris date/time without depending on the server timezone.
export function parisDate(date: string, minute: number) {
  const guess = new Date(`${date}T00:00:00Z`).getTime() + minute * 60000;
  let candidate = new Date(guess);
  for (let i = 0; i < 3; i++) {
    const local = parisTime(candidate);
    const localEpoch =
      new Date(`${local.date}T00:00:00Z`).getTime() + local.minute * 60000;
    candidate = new Date(candidate.getTime() + guess - localEpoch);
  }
  return candidate;
}

export function nextPresence(
  schedule: PresenceWindow[],
  at = new Date(),
): Date | null {
  const local = parisTime(at);
  for (let offset = 0; offset < 8; offset++) {
    const day = ((local.day - 1 + offset) % 7) + 1;
    const date = new Date(`${local.date}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    for (const window of schedule.filter((w) => w.day === day)) {
      const start = parisDate(
        date.toISOString().slice(0, 10),
        minutes(window.start),
      );
      if (start >= at) return start;
    }
  }
  return null;
}
