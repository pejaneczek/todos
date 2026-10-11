import type { Todo } from './types.js';

export interface TodoStats { total: number; done: number; open: number; percentDone: number }

export function computeStats(todos: Todo[]): TodoStats {
  const done = todos.filter((t) => t.done).length;   // adjust to the real field name
  const total = todos.length;
  return { total, done, open: total - done, percentDone: total === 0 ? 0 : Math.round((done / total) * 100) };
}
