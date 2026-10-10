import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useNotice } from './useNotice'

it('starts without a notice and exposes a notification callback', () => {
  const { result } = renderHook(() => useNotice())
  expect(result.current.message).toBe('')
  expect(result.current.notify).toEqual(expect.any(Function))
})

afterEach(() => vi.useRealTimers())

it('shows a notice and clears it after 4 seconds', () => {
  vi.useFakeTimers()
  const { result } = renderHook(() => useNotice())
  act(() => result.current.notify('Saved'))
  expect(result.current.message).toBe('Saved')
  act(() => vi.advanceTimersByTime(3999))
  expect(result.current.message).toBe('Saved')
  act(() => vi.advanceTimersByTime(1))
  expect(result.current.message).toBe('')
})

it('restarts the timer when a new notice arrives', () => {
  vi.useFakeTimers()
  const { result } = renderHook(() => useNotice())
  act(() => result.current.notify('One'))
  act(() => vi.advanceTimersByTime(3000))
  act(() => result.current.notify('Two'))
  act(() => vi.advanceTimersByTime(3000))
  expect(result.current.message).toBe('Two')
  act(() => vi.advanceTimersByTime(1000))
  expect(result.current.message).toBe('')
})
