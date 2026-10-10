import { act, renderHook } from '@testing-library/react'
import { expect, it } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { useTodoFilters } from './useTodoFilters'

const done = {
  ...todoFixture,
  id: 8,
  title: 'Done thing',
  completed: true,
  due_date: '2026-10-20',
}
const dated = { ...todoFixture, id: 5, title: 'Dated', due_date: '2026-10-10' }

it('starts with default filters and shows all todos', () => {
  const { result } = renderHook(() => useTodoFilters([todoFixture, done]))
  expect(result.current.filter).toBe('all')
  expect(result.current.search).toBe('')
  expect(result.current.sort).toBe('newest')
  expect(result.current.visible).toEqual([done, todoFixture])
})

it('updates visible todos when filter and search change', () => {
  const { result } = renderHook(() => useTodoFilters([todoFixture, done]))
  act(() => result.current.setFilter('completed'))
  expect(result.current.visible).toEqual([done])
  act(() => result.current.setFilter('all'))
  act(() => result.current.setSearch('demo'))
  expect(result.current.visible).toEqual([todoFixture])
})

it('reorders visible todos when the sort changes', () => {
  const { result } = renderHook(() =>
    useTodoFilters([todoFixture, done, dated]),
  )
  act(() => result.current.setSort('due'))
  expect(result.current.sort).toBe('due')
  expect(result.current.visible.map((todo) => todo.id)).toEqual([5, 8, 7])
})
