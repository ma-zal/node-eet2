const pragueFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Prague',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Převede okamžik na lokální čas v Praze s vyznačenou časovou zónou,
 * např. `2027-01-09T04:25:28+01:00` (SEČ) nebo `2027-06-09T05:25:28+02:00` (SELČ).
 *
 * Odpovídá formátu dateTime dle XSD a pravidlu z technické specifikace (kap. 3.3.3.2):
 * čas v ČR se uvádí s offsetem +01:00 / +02:00. Milisekundy se zahazují.
 */
export function formatEetDateTime(date: Date): string {
  const time = date.getTime();
  if (Number.isNaN(time)) {
    throw new RangeError('Neplatné datum a čas.');
  }
  const parts: Record<string, string> = {};
  for (const part of pragueFormatter.formatToParts(date)) {
    parts[part.type] = part.value;
  }
  const local = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;

  // Offset = rozdíl mezi lokálním časem (čteným jako UTC) a skutečným okamžikem na celé sekundy.
  const wholeSecondsTime = Math.floor(time / 1000) * 1000;
  const offsetMinutes = Math.round((Date.parse(`${local}Z`) - wholeSecondsTime) / 60_000);
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absMinutes = Math.abs(offsetMinutes);
  return `${local}${sign}${pad2(Math.floor(absMinutes / 60))}:${pad2(absMinutes % 60)}`;
}
