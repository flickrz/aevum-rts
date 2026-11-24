// Aevum - player level and rank from TP (points). Pure data, display only: TP itself is verified by the server.
// Level n needs 5 * n * (n - 1) TP in total: 2 -> 10, 3 -> 30, 4 -> 60, 5 -> 100, 10 -> 450, 20 -> 1900.
import { tr } from './i18n.js';
export const RANKS = ['Acemi', 'Er', 'Onbaşı', 'Çavuş', 'Teğmen', 'Yüzbaşı', 'Binbaşı', 'Albay', 'General', 'Mareşal', 'İmparator'].map((r) => tr(r));
export const tpForLevel = (n) => 5 * n * (n - 1);
// -> {level, rank, tp, cur (TP into this level), need (TP of this level), next (TP total of the next level), frac 0..1}
export function levelOf(tp) {
  tp = Math.max(0, Math.floor(Number(tp) || 0));
  let level = 1;
  while (level < 999 && tpForLevel(level + 1) <= tp) level++;
  const base = tpForLevel(level), next = tpForLevel(level + 1);
  const rank = RANKS[Math.min(RANKS.length - 1, Math.floor((level - 1) / 2))];
  return { level, rank, tp, cur: tp - base, need: next - base, next, frac: (tp - base) / (next - base) };
}
