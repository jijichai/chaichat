export function fmtTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function fmtPreview(text: string, max = 48): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

/** Stable pastel color for a nick (avatar/name tinting). */
export function nickColor(nick: string): string {
  let h = 0;
  for (let i = 0; i < nick.length; i++) h = (h * 31 + nick.charCodeAt(i)) % 360;
  return `hsl(${h} 55% 65%)`;
}

export function initials(nick: string): string {
  const parts = nick.replace(/[^a-zA-Z0-9-]/g, '').split('-').filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return nick.slice(0, 2).toUpperCase();
}
