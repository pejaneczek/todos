import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { expect, it } from 'vitest'
import { todoKeys } from '../api/queryKeys'
import { useTodosBusy } from './useTodosBusy'

function setup() {
  const client = new QueryClient()
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children)
  return { client, wrapper }
}

function startMutation(client: QueryClient, mutationKey: readonly string[]) {
  let release!: () => void
  const pending = client
    .getMutationCache()
    .build(client, {
      mutationKey,
      mutationFn: () => new Promise<void>((resolve) => (release = resolve)),
    })
    .execute(undefined)
  return { pending, release: () => release() }
}

it.each([
  { mutationKey: todoKeys.create },
  { mutationKey: todoKeys.update },
  { mutationKey: todoKeys.delete },
])(
  'is busy only while the $mutationKey mutation is pending',
  async ({ mutationKey }) => {
    const { client, wrapper } = setup()
    const { result } = renderHook(() => useTodosBusy(), { wrapper })
    expect(result.current).toBe(false)

    const mutation = startMutation(client, mutationKey)
    await waitFor(() => expect(result.current).toBe(true))
    mutation.release()
    await mutation.pending
    await waitFor(() => expect(result.current).toBe(false))
  },
)

it('ignores mutations with unrelated keys', async () => {
  const { client, wrapper } = setup()
  const { result } = renderHook(() => useTodosBusy(), { wrapper })
  const mutation = startMutation(client, ['other'])
  await waitFor(() => expect(client.isMutating()).toBe(1))
  // Let the cache notification reach the hook before asserting the negative.
  await act(async () => {})
  expect(result.current).toBe(false)
  mutation.release()
  await mutation.pending
})
