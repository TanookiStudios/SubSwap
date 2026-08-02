// Human-readable durations for the "this saved you X" line. Pure, so the
// wording is testable — a stat that reads wrong ("90 minutes") undercuts the
// whole point of showing it.

export function humanDuration(seconds) {
  const total = Math.max(0, Math.round(seconds));
  if (total < 90) return `${total} second${total === 1 ? "" : "s"}`;

  // Rounding first means 3599 seconds becomes "1 hour" rather than the
  // slightly daft "60 minutes".
  const minutes = Math.round(total / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;

  const hours = total / 3600;
  // One decimal place while it's still a small number of hours, because
  // "1.5 hours" is friendlier and more honest than "2 hours".
  const shown = hours < 10 ? Math.round(hours * 10) / 10 : Math.round(hours);
  return `${shown} hour${shown === 1 ? "" : "s"}`;
}
