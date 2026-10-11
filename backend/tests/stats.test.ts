import { it, expect } from 'vitest';
import { computeStats } from '../src/features/todos/stats.ts';
import { todo } from './fixture.ts';

const make = (completed: boolean, id: number) => ({ ...todo, id, completed });

it('returns zeros for an empty list', () => {
  expect(computeStats([])).toEqual({ total: 0, done: 0, open: 0, percentDone: 0 });
});

it('counts all open todos', () => {
  expect(computeStats([make(false, 1), make(false, 2)])).toEqual({ total: 2, done: 0, open: 2, percentDone: 0 });
});

it('counts all done todos', () => {
  expect(computeStats([make(true, 1), make(true, 2)])).toEqual({ total: 2, done: 2, open: 0, percentDone: 100 });
});

it.each([
  [[true, false], 50],
  [[true, false, false], 33],
  [[true, true, false], 67],
])('rounds percentDone for %j to %i', (flags, percent) => {
  const stats = computeStats(flags.map((c, i) => make(c, i + 1)));
  expect(stats.percentDone).toBe(percent);
  expect(stats.done + stats.open).toBe(stats.total);
});
