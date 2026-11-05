import { Prisma } from '../../generated/prisma/client';

export const DEFAULT_TIMEZONE = 'Asia/Kabul';

/**
 * Today's date ("YYYY-MM-DD") in a named IANA timezone, produced without any
 * `getUTC*`/`toISOString` math so it does not depend on the server's local
 * clock offset. This is the canonical source of the "business date" for the
 * org (check-in/check-out, contract close, assignment end, etc.).
 */
export function businessToday(timezone: string = DEFAULT_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const value = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

/**
 * The organisation's business today, falling back to the default timezone when
 * the organisation row is missing (or has no explicit timezone). Requires a
 * client with an `organization` delegate, i.e. the main client or an
 * interactive-transaction client.
 */
export async function businessTodayForOrg(
  client: Prisma.TransactionClient,
  organizationId: string,
): Promise<string> {
  const org = await client.organization.findUnique({
    where: { id: organizationId },
    select: { timezone: true },
  });
  return businessToday(org?.timezone || DEFAULT_TIMEZONE);
}

/** Converts a "YYYY-MM-DD" business date to a UTC-midnight Date for @db.Date columns. */
export function toDateOnly(d: string): Date {
  return new Date(`${d}T00:00:00.000Z`);
}