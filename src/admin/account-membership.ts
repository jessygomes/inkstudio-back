export function getMembershipDuration(createdAt: string | Date | null | undefined, now = new Date()) {
  if (!createdAt) return null;
  const source = new Date(createdAt);
  if (!Number.isFinite(source.getTime()) || source > now) return null;
  const civilDate = (value: Date) => {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
    const get = (type: string) => Number(parts.find(part => part.type === type)?.value);
    return new Date(Date.UTC(get("year"), get("month") - 1, get("day")));
  };
  const start = civilDate(source), end = civilDate(now);
  const monthAnchor = (months: number) => {
    const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, 1));
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(start.getUTCDate(), last));
    return date;
  };
  let completeMonths = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth();
  if (monthAnchor(completeMonths) > end) completeMonths--;
  const years = Math.floor(completeMonths / 12), months = completeMonths % 12;
  const days = Math.floor((end.getTime() - monthAnchor(completeMonths).getTime()) / 86_400_000);
  const totalDays = Math.floor((end.getTime() - start.getTime()) / 86_400_000);
  const units = [years ? `${years} an${years > 1 ? "s" : ""}` : "", months ? `${months} mois` : "", days ? `${days} jour${days > 1 ? "s" : ""}` : ""].filter(Boolean);
  return { since: source.toISOString(), years, months, days, totalDays, label: units.slice(0, 2).join(", ") || "Aujourd’hui" };
}
