import { Link, useLocation } from 'react-router-dom';
import { useTheme } from '../../contexts/ThemeContext';
import clsx from 'clsx';

interface NavItem {
  label: string;
  path: string;
  icon: string;
}

const navItems: NavItem[] = [
  { label: 'Explorer', path: '/tasks', icon: 'folder_open' },
  { label: 'Agents', path: '/', icon: 'smart_toy' },
  { label: 'Runs', path: '/runs', icon: 'play_arrow' },
  { label: 'Settings', path: '/settings', icon: 'settings' },
];

export function SideNavBar() {
  const location = useLocation();
  const { resolvedTheme, setTheme, theme } = useTheme();

  const toggleTheme = () => {
    if (theme === 'dark' || theme === 'system') {
      setTheme('light');
    } else if (theme === 'light') {
      setTheme('dark');
    } else {
      setTheme('dark');
    }
  };

  return (
    <aside className="fixed left-0 top-0 h-full z-50 w-14 flex flex-col items-center py-2 border-r border-outline-variant/30 bg-surface-container-lowest">
      {/* Logo */}
      <Link to="/" className="mb-2 flex items-center justify-center">
        <div className="w-8 h-8 bg-gradient-to-br from-primary to-primary-container rounded flex items-center justify-center">
          <span className="material-symbols-outlined text-on-primary-fixed font-bold" style={{ fontSize: '20px' }}>
            terminal
          </span>
        </div>
      </Link>

      {/* Main Navigation */}
      <nav className="flex flex-col gap-0.5 flex-1 w-full">
        {navItems.map((item) => {
          const isActive = item.path === '/'
            ? location.pathname === '/'
            : location.pathname.startsWith(item.path);
          return (
            <Link
              key={item.path}
              to={item.path}
              className={clsx(
                'flex flex-col items-center justify-center py-0.5 rounded-lg transition-all duration-150',
                isActive
                  ? 'text-primary bg-primary/10'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
              )}
              title={item.label}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '24px' }}>{item.icon}</span>
              <span className="text-[14px] font-mono">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Bottom Actions */}
      <div className="flex flex-col gap-0.5 w-full mt-auto">
        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          className="flex flex-col items-center justify-center py-0.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
          title={resolvedTheme === 'dark' ? 'Switch to Light' : 'Switch to Dark'}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '24px' }}>
            {resolvedTheme === 'dark' ? 'light_mode' : 'dark_mode'}
          </span>
          <span className="text-[14px] font-mono">
            {resolvedTheme === 'dark' ? 'Light' : 'Dark'}
          </span>
        </button>

        {/* Terminal */}
        <button
          onClick={() => alert('Terminal feature coming soon!')}
          className="flex flex-col items-center justify-center py-0.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
          title="Terminal"
        >
          <span className="material-symbols-outlined" style={{ fontSize: '24px' }}>terminal</span>
          <span className="text-[14px] font-mono">Terminal</span>
        </button>

        {/* Debug */}
        <button
          onClick={() => alert('Debug feature coming soon!')}
          className="flex flex-col items-center justify-center py-0.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
          title="Debug"
        >
          <span className="material-symbols-outlined" style={{ fontSize: '24px' }}>bug_report</span>
          <span className="text-[14px] font-mono">Debug</span>
        </button>
      </div>
    </aside>
  );
}