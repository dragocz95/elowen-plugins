import { registerTodoUi } from './runtime';
import { TasksPicker } from './TasksPicker';
import { TodoCard } from './TodoCard';

registerTodoUi({
  requiresApiVersion: 17,
  chatPickers: { tasks: TasksPicker },
  chatCards: { todos: TodoCard },
});
