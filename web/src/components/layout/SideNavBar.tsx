import { Link, useLocation } from 'react-router-dom';
import { useTheme } from '../../contexts/ThemeContext';
import { useTranslation } from '../../contexts/LanguageContext';
import clsx from 'clsx';

interface NavItem {
  labelKey: string;
  path: string;
  icon: string;
}

const navItems: NavItem[] = [
  { labelKey: 'dashboard', path: '/', icon: 'dashboard' },
  { labelKey: 'tasks', path: '/tasks', icon: 'list_alt' },
  { labelKey: 'runs', path: '/runs', icon: 'play_arrow' },
  { labelKey: 'settings', path: '/settings', icon: 'settings' },
];

export function SideNavBar() {
  const location = useLocation();
  const { resolvedTheme, setTheme, theme } = useTheme();
  const t = useTranslation();

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
          const label = t[item.labelKey] || item.labelKey;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={clsx(
                'flex items-center justify-center py-1.5 rounded-lg transition-all duration-150',
                isActive
                  ? 'text-primary bg-primary/10'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
              )}
              title={label}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '22px' }}>{item.icon}</span>
            </Link>
          );
        })}
      </nav>

      {/* Bottom Actions */}
      <div className="flex flex-col gap-0.5 w-full mt-auto">
        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          className="flex items-center justify-center py-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
          title={resolvedTheme === 'dark' ? 'Switch to Light' : 'Switch to Dark'}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '22px' }}>
            {resolvedTheme === 'dark' ? 'light_mode' : 'dark_mode'}
          </span>
        </button>
      </div>
    </aside>
  );
}