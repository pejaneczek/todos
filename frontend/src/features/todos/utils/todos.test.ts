import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  formatDate,
  isOverdue,
  priorityLabels,
  selectTodos,
  validateTodo,
} from './todos'
import type { Todo } from '../types'

const base: Todo = {
  id: 1,
  title: 'Sprint plan',
  description: '',
  priority: 'medium',
  completed: false,
  due_date: null,
  created_at: '2026-10-01T12:00:00Z',
  updated_at: '2026-10-01T12:00:00Z',
}

describe('selectTodos', () => {
  it('combines status with a case-insensitive search in the description', () => {
    const matching = { ...base, description: 'Discuss the API' }
    const todos = [
      matching,
      { ...matching, id: 2, completed: true },
      { ...base, id: 3 },
    ]
    expect(selectTodos(todos, 'active', ' api ', 'newest')).toEqual([matching])
  })

  it('sorts by priority without changing the source array', () => {
    const high: Todo = { ...base, id: 2, priority: 'high' }
    const todos = [base, high]
    expect(selectTodos(todos, 'all', '', 'priority')).toEqual([high, base])
    expect(todos).toEqual([base, high])
  })

  it('sorts by due date with undated last', () => {
    const a = { ...base, id: 1, due_date: '2026-11-02' }
    const b = { ...base, id: 2, due_date: '2026-11-01' }
    const c = { ...base, id: 3, due_date: null }
    expect(selectTodos([c, a, b], 'all', '', 'due').map((t) => t.id)).toEqual([
      2, 1, 3,
    ])
  })

  it('sorts newest by created_at, breaking ties by id', () => {
    const old = { ...base, id: 1, created_at: '2026-09-01T00:00:00Z' }
    const t1 = { ...base, id: 2 }
    const t2 = { ...base, id: 3 }
    expect(
      selectTodos([old, t1, t2], 'all', '', 'newest').map((t) => t.id),
    ).toEqual([3, 2, 1])
  })

  it('filters completed todos', () => {
    const done = { ...base, id: 2, completed: true }
    expect(selectTodos([base, done], 'completed', '', 'newest')).toEqual([done])
  })
})

describe('validateTodo', () => {
  const ok = {
    title: 'A',
    description: '',
    priority: 'medium' as const,
    due_date: null,
    completed: false,
  }

  it('accepts a valid todo', () => {
    expect(validateTodo(ok)).toEqual({})
  })

  it('rejects blank and too long titles', () => {
    expect(validateTodo({ ...ok, title: '   ' }).title).toBe(
      'Enter a task title.',
    )
    expect(validateTodo({ ...ok, title: 'a'.repeat(120) })).toEqual({})
    expect(validateTodo({ ...ok, title: 'a'.repeat(121) }).title).toMatch(/120/)
  })

  it('limits description to 2000 characters', () => {
    expect(validateTodo({ ...ok, description: 'a'.repeat(2000) })).toEqual({})
    expect(
      validateTodo({ ...ok, description: 'a'.repeat(2001) }).description,
    ).toMatch(/2000/)
  })

  it('rejects invalid calendar dates and formats', () => {
    expect(validateTodo({ ...ok, due_date: '2026-02-30' }).due_date).toBe(
      'Enter a valid date.',
    )
    expect(validateTodo({ ...ok, due_date: 'tomorrow' }).due_date).toBe(
      'Enter a valid date.',
    )
    expect(validateTodo({ ...ok, due_date: '2028-02-29' })).toEqual({})
  })
})

describe('isOverdue', () => {
  afterEach(() => vi.useRealTimers())

  it('is overdue only for open todos with a past due date', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 15, 12))
    expect(isOverdue({ ...base, due_date: '2026-10-14' })).toBe(true)
    expect(isOverdue({ ...base, due_date: '2026-10-15' })).toBe(false)
    expect(isOverdue({ ...base, due_date: null })).toBe(false)
    expect(
      isOverdue({ ...base, due_date: '2026-10-14', completed: true }),
    ).toBe(false)
  })
})

describe('formatDate', () => {
  it('formats as en-GB short date', () => {
    expect(formatDate('2026-10-05')).toBe('5 Oct 2026')
  })
})

it('exposes priority labels', () => {
  expect(priorityLabels).toEqual({ low: 'Low', medium: 'Medium', high: 'High' })
})
