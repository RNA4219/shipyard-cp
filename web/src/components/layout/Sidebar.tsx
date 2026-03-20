import { Link, useLocation } from 'react-router-dom';
import {
  ListTodo,
  Activity,
  Settings,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { useState } from 'react';
import clsx from 'clsx';

interface NavItem {
  label: string;
  path: string;
  icon: React.ReactNode;
}

const navItems: NavItem[] = [
  { label: 'Tasks', path: '/tasks', icon: <ListTodo className="h-4 w-4" /> },
  { label: 'Runs', path: '/runs', icon: <Activity className="h-4 w-4" /> },
];

export function Sidebar() {
  const location = useLocation();
  const [expanded, setExpanded] = useState(true);

  return (
    <aside className="w-64 bg-[#252526] border-r border-[#3c3c3c] flex flex-col">
      {/* Navigation */}
      <nav className="flex-1 p-2">
        <div className="mb-2">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-xs font-semibold text-gray-400 uppercase tracking-wider hover:text-gray-200 w-full"
          >
            {expanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            Explorer
          </button>
        </div>

        {expanded && (
          <ul className="space-y-0.5">
            {navItems.map((item) => {
              const isActive = location.pathname.startsWith(item.path);
              return (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    className={clsx(
                      'flex items-center gap-2 px-2 py-1.5 rounded text-sm',
                      isActive
                        ? 'bg-[#37373d] text-white'
                        : 'text-gray-400 hover:bg-[#2a2d2e] hover:text-gray-200'
                    )}
                  >
                    {item.icon}
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-[#3c3c3c]">
        <Link
          to="/settings"
          className="flex items-center gap-2 text-gray-400 hover:text-gray-200 text-sm"
        >
          <Settings className="h-4 w-4" />
          Settings
        </Link>
      </div>
    </aside>
  );
}