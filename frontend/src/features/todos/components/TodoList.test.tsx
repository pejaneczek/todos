import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { todoFixture } from '../../../test/todoFixture'
import { TodoList } from './TodoList'

vi.mock('../../../design-system', () => import('../../../design-system/mocks'))
vi.mock('./TodoEmptyState', () => ({
  TodoEmptyState: () => <p>Empty task list</p>,
}))
vi.mock('./TodoItem', () => ({
  TodoItem: ({
    todo,
    onEdit,
    onToggle,
    onDelete,
  }: {
    todo: { title: string }
    onEdit: () => void
    onToggle: () => void
    onDelete: () => void
  }) => (
    <li>
      <button onClick={onEdit}>{`Edit ${todo.title}`}</button>
      <button onClick={onToggle}>{`Toggle ${todo.title}`}</button>
      <button onClick={onDelete}>{`Delete ${todo.title}`}</button>
    </li>
  ),
}))

const baseProps = {
  todos: [],
  hasTodos: false,
  loading: false,
  failed: false,
  busy: false,
  onCreate: vi.fn(),
  onToggle: vi.fn(),
  onEdit: vi.fn(),
  onDelete: vi.fn(),
}

it('shows an unavailable message when loading failed and nothing is cached', () => {
  render(<TodoList {...baseProps} failed />)
  expect(
    screen.getByRole('heading', {
      name: 'The task list is temporarily unavailable',
    }),
  ).toBeVisible()
  expect(screen.queryByText('Empty task list')).not.toBeInTheDocument()
})

it('renders cached tasks even if a refetch failed, and forwards edit', async () => {
  const user = userEvent.setup()
  const onEdit = vi.fn()
  const todos = [
    { ...todoFixture, id: 1, title: 'First' },
    { ...todoFixture, id: 2, title: 'Second' },
  ]
  render(
    <TodoList {...baseProps} todos={todos} hasTodos failed onEdit={onEdit} />,
  )
  expect(screen.getAllByRole('listitem')).toHaveLength(2)
  await user.click(screen.getByRole('button', { name: 'Edit Second' }))
  expect(onEdit).toHaveBeenCalledWith(todos[1])
})

it('forwards the specific todo on toggle and delete', async () => {
  const user = userEvent.setup()
  const onToggle = vi.fn()
  const onDelete = vi.fn()
  const todos = [{ ...todoFixture, id: 1, title: 'First' }]
  render(
    <TodoList
      {...baseProps}
      todos={todos}
      hasTodos
      onToggle={onToggle}
      onDelete={onDelete}
    />,
  )
  await user.click(screen.getByRole('button', { name: 'Toggle First' }))
  await user.click(screen.getByRole('button', { name: 'Delete First' }))
  expect(onToggle).toHaveBeenCalledWith(todos[0])
  expect(onDelete).toHaveBeenCalledWith(todos[0])
})

it('shows loading feedback before showing an empty list', () => {
  const props = {
    todos: [],
    hasTodos: false,
    failed: false,
    busy: false,
    onCreate: vi.fn(),
    onToggle: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
  }
  const { rerender } = render(<TodoList {...props} loading />)
  expect(screen.getByRole('status')).toHaveTextContent('Loading your tasks…')
  expect(screen.queryByText('Empty task list')).not.toBeInTheDocument()
  rerender(<TodoList {...props} loading={false} />)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.getByText('Empty task list')).toBeVisible()
})
