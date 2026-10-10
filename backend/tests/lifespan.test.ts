import { afterEach, expect, it, vi } from 'vitest';
import { resolveDatabaseUrl } from '../src/core/config.ts';
import { createDatabase, initialize } from '../src/core/database.ts';
import { createApp } from '../src/factory.ts';
import { start } from '../src/core/lifespan.ts';

vi.mock('../src/core/database.ts', () => ({ createDatabase: vi.fn(), initialize: vi.fn() }));
vi.mock('../src/core/config.ts', () => ({ resolveDatabaseUrl: vi.fn().mockReturnValue('postgresql://x/y') }));
vi.mock('../src/factory.ts', () => ({ createApp: vi.fn() }));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

function setup() {
  const order: string[] = [];
  const database = {
    $connect: vi.fn(async () => { order.push('connect'); }),
    $disconnect: vi.fn(async () => { order.push('disconnect'); }),
  };
  vi.mocked(createDatabase).mockReturnValue(database as never);
  vi.mocked(initialize).mockImplementation(async () => { order.push('initialize'); });
  const server = { address: () => ({ port: 4321 }), once: vi.fn(), close: vi.fn() };
  const listen = vi.fn((port: number, host: string, cb: () => void) => { order.push('listen'); queueMicrotask(cb); return server; });
  vi.mocked(createApp).mockReturnValue({ listen } as never);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const handlers = new Map<string, () => void>();
  vi.spyOn(process, 'once').mockImplementation(((event: string, handler: () => void) => { handlers.set(event, handler); return process; }) as never);
  return { database, server, listen, order, handlers };
}

it('connects, initializes, then listens on the configured port', async () => {
  const { database, server, listen, order } = setup();
  vi.stubEnv('API_PORT', '9000');
  const result = await start();
  expect(order).toEqual(['connect', 'initialize', 'listen']);
  expect(resolveDatabaseUrl).toHaveBeenCalledWith();
  expect(createDatabase).toHaveBeenCalledWith('postgresql://x/y');
  expect(initialize).toHaveBeenCalledWith(database);
  expect(createApp).toHaveBeenCalledWith(database);
  expect(listen).toHaveBeenCalledWith(9000, '0.0.0.0', expect.any(Function));
  expect(console.log).toHaveBeenCalledWith('Taskly App Node API listening on port 4321');
  expect(result).toEqual({ server, database });
  expect(database.$disconnect).not.toHaveBeenCalled();
});
it('defaults to port 8000', async () => {
  const { listen } = setup();
  vi.stubEnv('API_PORT', '');
  await start();
  expect(listen.mock.calls[0][0]).toBe(8000);
});
it('disconnects and rethrows when initialization fails', async () => {
  const { database, listen } = setup();
  vi.mocked(initialize).mockRejectedValue(new Error('init failed'));
  await expect(start()).rejects.toThrow('init failed');
  expect(database.$disconnect).toHaveBeenCalledOnce();
  expect(listen).not.toHaveBeenCalled();
});
it('disconnects and rethrows when connecting fails', async () => {
  const { database } = setup();
  database.$connect.mockRejectedValue(new Error('no db'));
  await expect(start()).rejects.toThrow('no db');
  expect(database.$disconnect).toHaveBeenCalledOnce();
});
it('disconnects and rethrows when the server fails to listen', async () => {
  const { database, server, listen } = setup();
  listen.mockImplementation(() => {
    queueMicrotask(() => server.once.mock.calls.find(([event]) => event === 'error')?.[1](new Error('EADDRINUSE')));
    return server;
  });
  await expect(start()).rejects.toThrow('EADDRINUSE');
  expect(database.$disconnect).toHaveBeenCalledOnce();
});
it.each(['SIGTERM', 'SIGINT'])('closes the server and then disconnects on %s', async (signal) => {
  const { database, server, handlers } = setup();
  await start();
  handlers.get(signal)!();
  expect(server.close).toHaveBeenCalledOnce();
  expect(database.$disconnect).not.toHaveBeenCalled();
  await server.close.mock.calls[0][0]();
  expect(database.$disconnect).toHaveBeenCalledOnce();
  expect(process.exitCode).toBeUndefined();
});
it('logs and sets a failing exit code when disconnecting on shutdown fails', async () => {
  const { database, server, handlers } = setup();
  const failure = new Error('disconnect failed');
  const logError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  await start();
  database.$disconnect.mockRejectedValue(failure);
  handlers.get('SIGTERM')!();
  await server.close.mock.calls[0][0]();
  expect(logError).toHaveBeenCalledWith(failure);
  expect(process.exitCode).toBe(1);
});
