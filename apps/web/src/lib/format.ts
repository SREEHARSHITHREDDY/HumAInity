export const money = (n: number) =>
  '₹' + Math.round(n).toLocaleString('en-IN');

export const hrs = (n: number) =>
  (Math.round(n * 10) / 10).toString().replace(/\.0$/, '') + 'h';

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const shortDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
};
export const dayName = (iso: string) => DAY[new Date(iso).getUTCDay()];
export const fullDate = (iso: string) => {
  const d = new Date(iso);
  return `${DAY[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
export const stamp = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getDate()} ${MON[d.getMonth()]} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
export const isWeekend = (iso: string) => [0, 6].includes(new Date(iso).getUTCDay());
export const todayKey = () => new Date().toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => {
  const d = new Date(iso); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const eachDay = (from: string, to: string) => {
  const out: string[] = []; let c = from;
  while (c <= to) { out.push(c); c = addDays(c, 1); }
  return out;
};
