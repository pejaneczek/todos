import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { useNotice } from '../../hooks/useNotice'
import { useTodoFilters } from './hooks/useTodoFilters'
import { useTodosBusy } from './hooks/useTodosBusy'
import { useTodosQuery } from './hooks/useTodosQuery'
import { useUpdateTodoMutation } from './hooks/useUpdateTodoMutation'
import { TodosPage } from './TodosPage'
import { todoFixture } from '../../test/todoFixture'
import type { Todo } from './types'

vi.mock('../../design-system', () => import('../../design-system/mocks'))
vi.mock('../../hooks/useNotice', () => ({ useNotice: vi.fn() }))
vi.mock('./hooks/useTodoFilters', () => ({ useTodoFilters: vi.fn() }))
vi.mock('./hooks/useTodosBusy', () => ({ useTodosBusy: vi.fn() }))
vi.mock('./hooks/useTodosQuery', () => ({ useTodosQuery: vi.fn() }))
vi.mock('./hooks/useUpdateTodoMutation', () => ({
  useUpdateTodoMutation: vi.fn(),
}))
vi.mock('./components/TodosHeader', () => ({
  TodosHeader: () => <h1>Tasks</h1>,
}))
vi.mock('./components/TodoFilters', () => ({ TodoFilters: () => null }))
vi.mock('./components/TodoList', () => ({
  TodoList: ({
    todos,
    onToggle,
  }: {
    todos: Todo[]
    onToggle: (todo: Todo) => void
  }) => (
    <button type="button" onClick={() => todos[0] && onToggle(todos[0])}>
      Toggle
    </button>
  ),
}))
vi.mock('./components/TodoEditor', () => ({ TodoEditor: () => null }))
vi.mock('./components/DeleteTodoDialog', () => ({
  DeleteTodoDialog: () => null,
}))
vi.mock('../../components/SuccessNotice', () => ({ SuccessNotice: () => null }))

function arrange(
  mutateAsync: ReturnType<typeof vi.fn>,
  notify: (message: string) => void,
  busy = false,
) {
  vi.mocked(useTodosQuery).mockReturnValue({
    data: [todoFixture],
    isPending: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useTodosQuery>)
  vi.mocked(useUpdateTodoMutation).mockReturnValue({
    error: null,
    reset: vi.fn(),
    mutateAsync,
  } as unknown as ReturnType<typeof useUpdateTodoMutation>)
  vi.mocked(useTodosBusy).mockReturnValue(busy)
  vi.mocked(useNotice).mockReturnValue({ message: '', notify })
  vi.mocked(useTodoFilters).mockReturnValue({
    filter: 'all',
    search: '',
    sort: 'newest',
    visible: [todoFixture],
    setFilter: vi.fn(),
    setSearch: vi.fn(),
    setSort: vi.fn(),
  })
}

it.each([
  [true, 'Another task complete. Well done!'],
  [false, 'Task marked as active.'],
])(
  'toggles a task and notifies when saved completed=%s',
  async (completed, message) => {
    const user = userEvent.setup()
    const mutateAsync = vi.fn().mockResolvedValue({ ...todoFixture, completed })
    const notify = vi.fn()
    arrange(mutateAsync, notify)
    render(<TodosPage />)
    await user.click(screen.getByRole('button', { name: 'Toggle' }))
    expect(mutateAsync).toHaveBeenCalledWith({
      id: todoFixture.id,
      input: { completed: !todoFixture.completed },
    })
    expect(notify).toHaveBeenCalledWith(message)
  },
)

it('does not toggle while busy', async () => {
  const user = userEvent.setup()
  const mutateAsync = vi.fn()
  arrange(mutateAsync, vi.fn(), true)
  render(<TodosPage />)
  await user.click(screen.getByRole('button', { name: 'Toggle' }))
  expect(mutateAsync).not.toHaveBeenCalled()
})

it('swallows toggle failures without notifying', async () => {
  const user = userEvent.setup()
  const mutateAsync = vi.fn().mockRejectedValue(new Error('fail'))
  const notify = vi.fn()
  arrange(mutateAsync, notify)
  render(<TodosPage />)
  await user.click(screen.getByRole('button', { name: 'Toggle' }))
  expect(mutateAsync).toHaveBeenCalledTimes(1)
  expect(notify).not.toHaveBeenCalled()
})

it('displays a query failure and resets mutation errors before retrying', async () => {
  const user = userEvent.setup()
  const refetch = vi.fn().mockResolvedValue(undefined)
  const reset = vi.fn()
  vi.mocked(useTodosQuery).mockReturnValue({
    data: [],
    isPending: false,
    isFetching: false,
    isError: true,
    error: new Error('The server is unavailable.'),
    refetch,
  } as unknown as ReturnType<typeof useTodosQuery>)
  vi.mocked(useUpdateTodoMutation).mockReturnValue({
    error: null,
    reset,
    mutateAsync: vi.fn(),
  } as unknown as ReturnType<typeof useUpdateTodoMutation>)
  vi.mocked(useTodosBusy).mockReturnValue(false)
  vi.mocked(useNotice).mockReturnValue({ message: '', notify: vi.fn() })
  vi.mocked(useTodoFilters).mockReturnValue({
    filter: 'all',
    search: '',
    sort: 'newest',
    visible: [],
    setFilter: vi.fn(),
    setSearch: vi.fn(),
    setSort: vi.fn(),
  })
  render(<TodosPage />)
  expect(screen.getByTestId('alert')).toHaveTextContent(
    'The server is unavailable.',
  )
  await user.click(screen.getByRole('button', { name: 'Try again' }))
  await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1))
  expect(reset).toHaveBeenCalledTimes(1)
  expect(reset.mock.invocationCallOrder[0]).toBeLessThan(
    refetch.mock.invocationCallOrder[0],
  )
})
