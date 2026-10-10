import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { createElement, type ReactNode } from 'react'
import { expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { todoKeys } from '../api/queryKeys'
import { todosApi } from '../api/todos'
import { useUpdateTodoMutation } from './useUpdateTodoMutation'

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

it('replaces only the updated todo in the cached list and cancels list queries', async () => {
  const other = { ...todoFixture, id: 9, title: 'Other' }
  const saved = { ...todoFixture, title: 'Renamed' }
  vi.mocked(todosApi.update).mockResolvedValue(saved)
  const { client, wrapper } = setup()
  client.setQueryData(todoKeys.list, [todoFixture, other])
  const cancel = vi.spyOn(client, 'cancelQueries')
  const { result } = renderHook(() => useUpdateTodoMutation(), { wrapper })
  await act(() =>
    result.current.mutateAsync({
      id: todoFixture.id,
      input: { title: 'Renamed' },
    }),
  )
  expect(todosApi.update).toHaveBeenCalledWith(todoFixture.id, {
    title: 'Renamed',
  })
  expect(client.getQueryData(todoKeys.list)).toEqual([saved, other])
  expect(cancel).toHaveBeenCalledWith({ queryKey: todoKeys.list })
  expect(client.getMutationCache().getAll()[0].options.mutationKey).toEqual(
    todoKeys.update,
  )
})

it('does not create a list when none is cached', async () => {
  vi.mocked(todosApi.update).mockResolvedValue(todoFixture)
  const { client, wrapper } = setup()
  const { result } = renderHook(() => useUpdateTodoMutation(), { wrapper })
  await act(() =>
    result.current.mutateAsync({ id: 7, input: { completed: true } }),
  )
  expect(client.getQueryData(todoKeys.list)).toBeUndefined()
})

it('leaves the cache untouched when the update fails', async () => {
  vi.mocked(todosApi.update).mockRejectedValue(new Error('nope'))
  const { client, wrapper } = setup()
  client.setQueryData(todoKeys.list, [todoFixture])
  const { result } = renderHook(() => useUpdateTodoMutation(), { wrapper })
  await act(async () => {
    await expect(
      result.current.mutateAsync({ id: 7, input: { title: 'x' } }),
    ).rejects.toThrow('nope')
  })
  expect(client.getQueryData(todoKeys.list)).toEqual([todoFixture])
})
