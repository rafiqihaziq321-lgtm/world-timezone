// Calendar events: an .ics file (Apple, Outlook, Google) or a Google Calendar
// link, for a planned meeting or a month of prayer times. Times are in UTC.

const pad = (n) => String(n).padStart(2, '0');

// 20261023T010000Z
export function utcStamp(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

// RFC 5545 text: escape \ ; , and newlines.
function icsText(text) {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

// RFC 5545 lines are at most 75 octets; longer ones continue after CRLF + space.
function fold(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = '';
      size = 0;
    }
    current += ch;
    size += n;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

// One calendar of events, each { uid, start, end, title, description } and,
// with `alarm`, a reminder that goes off at the start. A calendar people
// subscribe to also has a `name` and how often apps should fetch it again.
export function icsCalendar(events, now, { name, refreshHours } = {}) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Jam Dunia//MS', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  if (name) lines.push(`X-WR-CALNAME:${icsText(name)}`);
  if (refreshHours) lines.push(`REFRESH-INTERVAL;VALUE=DURATION:PT${refreshHours}H`, `X-PUBLISHED-TTL:PT${refreshHours}H`);
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${utcStamp(now)}`,
      `DTSTART:${utcStamp(e.start)}`,
      `DTEND:${utcStamp(e.end)}`,
      `SUMMARY:${icsText(e.title)}`,
      `DESCRIPTION:${icsText(e.description)}`,
    );
    if (e.alarm) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(e.title)}`, 'TRIGGER:PT0S', 'END:VALARM');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

export function icsEvent({ start, end, title, description, now }) {
  return icsCalendar([{ uid: `${utcStamp(start)}-${utcStamp(now)}@jam-dunia`, start, end, title, description }], now);
}

// Saves an .ics file through the browser's download.
export function downloadIcs(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function googleCalendarUrl({ start, end, title, description }) {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${utcStamp(start)}/${utcStamp(end)}`,
    details: description,
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}
