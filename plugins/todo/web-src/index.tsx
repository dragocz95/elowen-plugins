import { registerTodoUi } from './runtime';
import { TasksPicker } from './TasksPicker';
import { TodoCard } from './TodoCard';
import { TasksRail } from './TasksRail';

registerTodoUi({
  requiresApiVersion: 17,
  chatPickers: { tasks: TasksPicker },
  chatCards: { todos: TodoCard },
  chatRailSections: { todo: TasksRail },
});
