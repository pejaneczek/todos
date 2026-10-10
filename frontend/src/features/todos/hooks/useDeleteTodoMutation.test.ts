import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import { useDeleteTodoMutation } from './useDeleteTodoMutation'

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

describe('useDeleteTodoMutation', () => {
  it('removes only the deleted todo from the cached list', async () => {
    const { client, wrapper } = setup()
    const other = { ...todoFixture, id: 1 }
    client.setQueryData(todoKeys.list, [todoFixture, other])
    const cancel = vi.spyOn(client, 'cancelQueries')
    vi.mocked(todosApi.remove).mockResolvedValue(undefined)
    const { result } = renderHook(() => useDeleteTodoMutation(), { wrapper })
    await result.current.mutateAsync(todoFixture.id)
    expect(todosApi.remove).toHaveBeenCalledWith(todoFixture.id)
    expect(cancel).toHaveBeenCalledWith({ queryKey: todoKeys.list })
    expect(client.getQueryData(todoKeys.list)).toEqual([other])
    expect(client.getMutationCache().getAll()[0].options.mutationKey).toEqual(
      todoKeys.delete,
    )
  })

  it('does not create a cache entry when no list is cached', async () => {
    const { client, wrapper } = setup()
    vi.mocked(todosApi.remove).mockResolvedValue(undefined)
    const { result } = renderHook(() => useDeleteTodoMutation(), { wrapper })
    await result.current.mutateAsync(todoFixture.id)
    expect(client.getQueryData(todoKeys.list)).toBeUndefined()
  })

  it('keeps the list and exposes the error when deletion fails', async () => {
    const { client, wrapper } = setup()
    client.setQueryData(todoKeys.list, [todoFixture])
    vi.mocked(todosApi.remove).mockRejectedValue(new Error('nope'))
    const { result } = renderHook(() => useDeleteTodoMutation(), { wrapper })
    await expect(result.current.mutateAsync(todoFixture.id)).rejects.toThrow(
      'nope',
    )
    await waitFor(() => expect(result.current.error?.message).toBe('nope'))
    expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture])
  })
})
