/** Extract total page count from SOC result HTML (e.g. "Page  (1&nbsp;of&nbsp;6)"). */
export function parseTotalResultPages(html: string): number {
  const m = html.match(/of&nbsp;(\d+)/);
  if (m) return parseInt(m[1]!, 10);
  return 1;
}
