import request from 'supertest';
import { afterEach, expect, it, vi } from 'vitest';
import { createApp } from '../src/factory.ts';
import { record, todo } from './fixture.ts';

afterEach(() => vi.restoreAllMocks());

function setup() {
  const todoDelegate = { findMany: vi.fn().mockResolvedValue([record]) };
  const database = { todo: todoDelegate } as never;
  return { app: createApp(database), todoDelegate };
}

it('returns a JSON 404 for unknown routes', async () => {
  const response = await request(setup().app).get('/nope');
  expect(response.status).toBe(404);
  expect(response.body).toEqual({ detail: 'Not Found' });
});
it('does not expose the x-powered-by header', async () => {
  const response = await request(setup().app).get('/nope');
  expect(response.headers['x-powered-by']).toBeUndefined();
});
it('returns 422 for malformed JSON', async () => {
  const response = await request(setup().app).post('/api/todos').set('Content-Type', 'application/json').send('{bad');
  expect(response.status).toBe(422);
  expect(response.body).toEqual({ detail: 'Invalid JSON.' });
});
it('returns 413 for oversized bodies', async () => {
  const response = await request(setup().app).post('/api/todos').send({ title: 'x'.repeat(200_000) });
  expect(response.status).toBe(413);
  expect(response.body).toEqual({ detail: 'Request body too large.' });
});
it('returns 500 for unexpected errors and logs them', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const { app, todoDelegate } = setup();
  const failure = new Error('db down');
  todoDelegate.findMany.mockRejectedValue(failure);
  const response = await request(app).get('/api/todos');
  expect(response.status).toBe(500);
  expect(response.body).toEqual({ detail: 'Internal Server Error' });
  expect(error).toHaveBeenCalledWith(failure);
});
it('serves tasks through the todos router', async () => {
  const response = await request(setup().app).get('/api/todos');
  expect(response.status).toBe(200);
  expect(response.body).toEqual([todo]);
});
it('serves the OpenAPI specification', async () => {
  const response = await request(setup().app).get('/openapi.json');
  expect(response.status).toBe(200);
  expect(response.body).toHaveProperty('openapi');
  expect(response.body.paths).toHaveProperty(['/api/todos']);
});
