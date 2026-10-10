import express from 'express';
import request from 'supertest';
import { it, expect, vi, afterEach } from 'vitest';
import { createHealthRouter } from '../src/api/health.ts';

afterEach(() => vi.restoreAllMocks());

function setup(findFirst = vi.fn().mockResolvedValue({ id: 1 })) {
  const database = { todo: { findFirst } } as never;
  const app = express();
  app.use(createHealthRouter(database));
  return { app, findFirst };
}

it('returns status ok after probing the database', async () => {
  const { app, findFirst } = setup();
  const response = await request(app).get('/health');
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ status: 'ok' });
  expect(findFirst).toHaveBeenCalledWith({ select: { id: true } });
});

it('returns ok even when the table is empty', async () => {
  const { app } = setup(vi.fn().mockResolvedValue(null));
  const response = await request(app).get('/health');
  expect(response.status).toBe(200);
  expect(response.body).toEqual({ status: 'ok' });
});

it('returns 500 and not ok when the database probe rejects', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const { app } = setup(vi.fn().mockRejectedValue(new Error('db down')));
  const response = await request(app).get('/health');
  expect(response.status).toBe(500);
  expect(response.body).not.toEqual({ status: 'ok' });
});
