// Gera link "Adicionar ao Google Calendar" no formato oficial (sem OAuth).
// https://calendar.google.com/calendar/render?action=TEMPLATE&...

function fmt(d: Date, allDay = false) {
  const pad = (n: number) => String(n).padStart(2, "0");
  if (allDay) {
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  }
  // formato UTC: YYYYMMDDTHHmmssZ
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

export function buildGoogleCalendarUrl(opts: {
  title: string;
  start: Date;
  end?: Date | null;
  description?: string | null;
  location?: string | null;
  allDay?: boolean;
}) {
  const { title, start, description, location, allDay = false } = opts;
  const end =
    opts.end ??
    (allDay
      ? new Date(start.getTime() + 24 * 60 * 60 * 1000)
      : new Date(start.getTime() + 60 * 60 * 1000));

  const dates = allDay ? `${fmt(start, true)}/${fmt(end, true)}` : `${fmt(start)}/${fmt(end)}`;

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates,
  });
  if (description) params.set("details", description);
  if (location) params.set("location", location);

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
