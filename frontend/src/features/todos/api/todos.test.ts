import { beforeEach, expect, it, vi } from 'vitest'
import { request } from '../../../lib/http'
import { todoFixture } from '../../../test/todoFixture'
import { todosApi } from './todos'

vi.mock('../../../lib/http', () => ({ request: vi.fn() }))
beforeEach(() => vi.clearAllMocks())

it('passes the abort signal when fetching tasks', async () => {
  const signal = new AbortController().signal
  vi.mocked(request).mockResolvedValue([todoFixture])
  await expect(todosApi.list(signal)).resolves.toEqual([todoFixture])
  expect(request).toHaveBeenCalledWith('/todos', { signal })
})

it('patches only the provided fields and drops read-only ones', async () => {
  vi.mocked(request).mockResolvedValue(todoFixture)
  const input = { completed: true, id: 9 } as Parameters<
    typeof todosApi.update
  >[1]
  await todosApi.update(7, input)
  expect(request).toHaveBeenCalledWith('/todos/7', {
    method: 'PATCH',
    body: JSON.stringify({ completed: true }),
  })
})

it('deletes a task by id', async () => {
  vi.mocked(request).mockResolvedValue(undefined)
  await expect(todosApi.remove(3)).resolves.toBeUndefined()
  expect(request).toHaveBeenCalledWith('/todos/3', { method: 'DELETE' })
})

it('sends only writable task fields on creation', async () => {
  vi.mocked(request).mockResolvedValue(todoFixture)
  await expect(todosApi.create(todoFixture)).resolves.toEqual(todoFixture)
  expect(request).toHaveBeenCalledWith('/todos', {
    method: 'POST',
    body: JSON.stringify({
      title: todoFixture.title,
      description: '',
      priority: 'medium',
      due_date: null,
      completed: false,
    }),
  })
})
