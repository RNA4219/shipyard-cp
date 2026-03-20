import { Ship, Settings, Bell } from 'lucide-react';
import { useWebSocket } from '../../hooks/useWebSocket';

export function Header() {
  const { isConnected } = useWebSocket();

  return (
    <header className="h-12 bg-[#323233] border-b border-[#3c3c3c] flex items-center justify-between px-4">
      <div className="flex items-center gap-2">
        <Ship className="h-5 w-5 text-blue-400" />
        <span className="font-semibold text-white">Shipyard CP</span>
        <span className="text-xs text-gray-500 ml-2">Control Plane</span>
      </div>

      <div className="flex items-center gap-3">
        {/* Connection status */}
        <div className="flex items-center gap-1.5">
          <div
            className={`h-2 w-2 rounded-full ${
              isConnected ? 'bg-green-500' : 'bg-red-500'
            }`}
          />
          <span className="text-xs text-gray-400">
            {isConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>

        {/* Actions */}
        <button className="p-1.5 hover:bg-[#3c3c3c] rounded text-gray-400 hover:text-gray-200">
          <Bell className="h-4 w-4" />
        </button>
        <button className="p-1.5 hover:bg-[#3c3c3c] rounded text-gray-400 hover:text-gray-200">
          <Settings className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}