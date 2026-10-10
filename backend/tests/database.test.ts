import { expect, it, vi } from 'vitest';
import { createDatabase, initialize } from '../src/core/database.ts';

it('creates a Prisma client without connecting', () => {
  const database = createDatabase('postgresql://test:test@localhost:5432/test');
  expect(database.$connect).toBeTypeOf('function');
  expect(database.$executeRaw).toBeTypeOf('function');
  expect(database.todo.findMany).toBeTypeOf('function');
});
it('initializes the todos table with a single raw statement', async () => {
  const $executeRaw = vi.fn().mockResolvedValue(0);
  await initialize({ $executeRaw } as never);
  expect($executeRaw).toHaveBeenCalledOnce();
  const strings = $executeRaw.mock.calls[0][0] as string[];
  expect(strings.join('')).toContain('CREATE TABLE IF NOT EXISTS todos');
});
it('propagates initialization failures', async () => {
  const $executeRaw = vi.fn().mockRejectedValue(new Error('boom'));
  await expect(initialize({ $executeRaw } as never)).rejects.toThrow('boom');
});
