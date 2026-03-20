import { RunList } from '../components/runs/RunList';
import { Activity } from 'lucide-react';

export function RunsPage() {
  return (
    <div className="h-full flex flex-col">
      <div className="p-4 border-b border-[#3c3c3c] bg-[#252526]">
        <h1 className="text-lg font-semibold text-white flex items-center gap-2">
          <Activity className="h-5 w-5" />
          Runs
        </h1>
      </div>
      <div className="flex-1 overflow-auto">
        <RunList />
      </div>
    </div>
  );
}