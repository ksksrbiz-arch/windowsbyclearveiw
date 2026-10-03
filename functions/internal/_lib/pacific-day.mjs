// Business-day boundaries for Clearview operations, including Pacific daylight-saving transitions.
export function pacificDayRange(now = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).map(({ type, value }) => [type, value]));
  const year = Number(parts.year), month = Number(parts.month), day = Number(parts.day);
  const utcMidnight = (y, m, d) => {
    const target = Date.UTC(y, m - 1, d);
    let guess = target;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const shown = Object.fromEntries(formatter.formatToParts(new Date(guess)).map(({ type, value }) => [type, value]));
      const shownAsUtc = Date.UTC(Number(shown.year), Number(shown.month) - 1, Number(shown.day), Number(shown.hour), Number(shown.minute), Number(shown.second));
      const adjusted = guess + target - shownAsUtc;
      if (adjusted === guess) break;
      guess = adjusted;
    }
    return new Date(guess).toISOString();
  };
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return {
    start: utcMidnight(year, month, day),
    end: utcMidnight(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()),
  };
}

