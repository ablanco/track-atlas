// Keep date-only values as strings: Date/timezone conversion can shift birthdays.
export function formatBirthday(value: string, locale: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const [, year, month, day] = match;
  return locale === "es"
    ? `${day}/${month}/${year}`
    : `${month}/${day}/${year}`;
}

export function parseBirthday(value: string, locale: string): string {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  // Leave malformed values for the server's existing validation to reject.
  if (!match) return value;
  const [, first, second, year] = match;
  return locale === "es"
    ? `${year}-${second}-${first}`
    : `${year}-${first}-${second}`;
}
