import { registerTodoUi } from './runtime';
import { TasksPicker } from './TasksPicker';
import { TodoCard } from './TodoCard';
import { TasksRail } from './TasksRail';

registerTodoUi({
  requiresApiVersion: 18,
  chatPickers: { tasks: TasksPicker },
  chatCards: { todos: TodoCard },
  chatRailSections: { todo: TasksRail },
});
