import { formatDistanceToNow } from "date-fns";

// formatDistanceToNow throws a RangeError on an invalid date, and one bad
// feed timestamp thrown during render replaced the whole app with the crash
// screen. Fall back to a fixed label instead.
export function formatRelativeTime(value: string | number | Date | null | undefined, fallback = "recently") {
  if (value === null || value === undefined || value === "") return fallback;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return formatDistanceToNow(date, { addSuffix: true });
}
