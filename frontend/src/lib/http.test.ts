import { afterEach, describe, expect, it, vi } from 'vitest'
import { request } from './http'

function mockFetch(response: Partial<Response> | Error) {
  const fn = vi.fn()
  if (response instanceof Error) fn.mockRejectedValue(response)
  else fn.mockResolvedValue(response)
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

describe('request', () => {
  it('returns parsed JSON and merges headers', async () => {
    const fn = mockFetch({
      ok: true,
      status: 200,
      json: async () => ({ a: 1 }),
    })
    await expect(
      request('/x', { headers: { Authorization: 't' } }),
    ).resolves.toEqual({ a: 1 })
    expect(fn).toHaveBeenCalledWith('/api/x', {
      headers: { 'Content-Type': 'application/json', Authorization: 't' },
    })
  })

  it('returns undefined for 204', async () => {
    mockFetch({ ok: true, status: 204 })
    await expect(request('/x')).resolves.toBeUndefined()
  })

  it('throws the validation message for 422', async () => {
    mockFetch({ ok: false, status: 422, json: async () => ({ detail: 'raw' }) })
    await expect(request('/x')).rejects.toThrow(/Check the task details/)
  })

  it('throws a string detail from the error body', async () => {
    mockFetch({
      ok: false,
      status: 404,
      json: async () => ({ detail: 'Not found' }),
    })
    await expect(request('/x')).rejects.toThrow('Not found')
  })

  it('uses the generic message for non-JSON or non-string detail', async () => {
    mockFetch({
      ok: false,
      status: 500,
      json: async () => {
        throw new SyntaxError('bad')
      },
    })
    await expect(request('/x')).rejects.toThrow(
      'The operation failed. Please try again.',
    )
    mockFetch({ ok: false, status: 400, json: async () => ({ detail: [1] }) })
    await expect(request('/x')).rejects.toThrow(
      'The operation failed. Please try again.',
    )
  })

  it('reports connection problems on network errors', async () => {
    mockFetch(new TypeError('Failed to fetch'))
    await expect(request('/x')).rejects.toThrow(/Cannot connect to the server/)
  })

  it('rethrows the original error when the signal is aborted', async () => {
    const abort = new DOMException('aborted', 'AbortError')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abort))
    const controller = new AbortController()
    controller.abort()
    await expect(request('/x', { signal: controller.signal })).rejects.toBe(
      abort,
    )
  })
})
