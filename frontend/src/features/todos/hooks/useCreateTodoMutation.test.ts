import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import { useCreateTodoMutation } from './useCreateTodoMutation'

vi.mock('../api/todos', () => ({
  todosApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}))

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children)
  return { client, wrapper }
}

const input = {
  title: todoFixture.title,
  description: '',
  priority: 'medium' as const,
  due_date: null,
  completed: false,
}

describe('useCreateTodoMutation', () => {
  it('prepends the saved todo to the cached list and cancels in-flight list queries', async () => {
    const { client, wrapper } = setup()
    const older = { ...todoFixture, id: 1 }
    client.setQueryData(todoKeys.list, [older])
    const cancel = vi.spyOn(client, 'cancelQueries')
    vi.mocked(todosApi.create).mockResolvedValue(todoFixture)
    const { result } = renderHook(() => useCreateTodoMutation(), { wrapper })
    await result.current.mutateAsync(input)
    expect(todosApi.create).toHaveBeenCalledWith(input)
    expect(cancel).toHaveBeenCalledWith({ queryKey: todoKeys.list })
    expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture, older])
    expect(client.getMutationCache().getAll()[0].options.mutationKey).toEqual(
      todoKeys.create,
    )
  })

  it('creates the list when the cache is empty', async () => {
    const { client, wrapper } = setup()
    vi.mocked(todosApi.create).mockResolvedValue(todoFixture)
    const { result } = renderHook(() => useCreateTodoMutation(), { wrapper })
    await result.current.mutateAsync(input)
    expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture])
  })

  it('de-duplicates a todo with the same id', async () => {
    const { client, wrapper } = setup()
    client.setQueryData(todoKeys.list, [{ ...todoFixture, title: 'stale' }])
    vi.mocked(todosApi.create).mockResolvedValue(todoFixture)
    const { result } = renderHook(() => useCreateTodoMutation(), { wrapper })
    await result.current.mutateAsync(input)
    expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture])
  })

  it('leaves the cache untouched and exposes the error on failure', async () => {
    const { client, wrapper } = setup()
    const cached = [{ ...todoFixture, id: 1 }]
    client.setQueryData(todoKeys.list, cached)
    vi.mocked(todosApi.create).mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useCreateTodoMutation(), { wrapper })
    await expect(result.current.mutateAsync(input)).rejects.toThrow('boom')
    await waitFor(() => expect(result.current.error?.message).toBe('boom'))
    expect(client.getQueryData(todoKeys.list)).toEqual(cached)
  })
})
