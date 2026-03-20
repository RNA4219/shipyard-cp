import { TaskList } from '../components/tasks/TaskList';
import { ListTodo, Plus } from 'lucide-react';

export function TasksPage() {
  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b border-[#3c3c3c] bg-[#252526]">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-white flex items-center gap-2">
            <ListTodo className="h-5 w-5" />
            Tasks
          </h1>
          <button className="px-3 py-1.5 bg-[#0e639c] hover:bg-[#1177bb] rounded text-sm font-medium text-white flex items-center gap-1">
            <Plus className="h-4 w-4" />
            New Task
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        <TaskList />
      </div>
    </div>
  );
}