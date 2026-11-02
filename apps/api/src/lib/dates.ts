export const iso = (d: Date) => d.toISOString();
export const dayKey = (d: Date | string) =>
  (typeof d === 'string' ? new Date(d) : d).toISOString().slice(0, 10);
export const addDays = (d: Date | string, n: number) => {
  const x = new Date(typeof d === 'string' ? d : d.getTime());
  x.setUTCDate(x.getUTCDate() + n);
  return x;
};
export const eachDay = (start: string, end: string) => {
  const out: string[] = [];
  let cur = new Date(start);
  const stop = new Date(end);
  while (cur <= stop) { out.push(dayKey(cur)); cur = addDays(cur, 1); }
  return out;
};
export const isWeekend = (d: string) => [0, 6].includes(new Date(d).getUTCDay());
export const weekKey = (d: string) => {
  const dt = new Date(d);
  const day = (dt.getUTCDay() + 6) % 7;        // Monday = 0
  return dayKey(addDays(dt, -day));
};
