import { Link, useLocation } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import { useWebSocket } from '../../hooks/useWebSocket';
import { useTranslation } from '../../contexts/LanguageContext';
import { useSearch } from '../../contexts/SearchContext';
import { useNotifications } from '../../contexts/NotificationContext';
import { NotificationPanel } from '../common/NotificationPanel';

export function TopNavBar() {
  const { isConnected } = useWebSocket();
  const { searchQuery, setSearchQuery } = useSearch();
  const { unreadCount, isPanelOpen, togglePanel, closePanel } = useNotifications();
  const t = useTranslation();
  const location = useLocation();
  const prevPathRef = useRef(location.pathname);

  // Only show search on tasks and runs pages
  const showSearch = location.pathname === '/tasks' || location.pathname === '/runs' || location.pathname.startsWith('/tasks/') || location.pathname.startsWith('/runs/');

  // Clear search query when navigating between different pages
  useEffect(() => {
    if (prevPathRef.current !== location.pathname) {
      const prevPage = prevPathRef.current.split('/')[1] || 'dashboard';
      const currentPage = location.pathname.split('/')[1] || 'dashboard';
      // Clear search when navigating to a different page type
      if (prevPage !== currentPage && searchQuery) {
        setSearchQuery('');
      }
      prevPathRef.current = location.pathname;
    }
  }, [location.pathname, searchQuery, setSearchQuery]);

  return (
    <header className="fixed top-0 left-14 right-0 z-40 h-12 px-2 md:px-3 border-b border-outline-variant/20 bg-surface-container-lowest/80 backdrop-blur-md shadow-sm shadow-black/10">
      <div className="flex items-center justify-between h-full w-full max-w-screen-xl mx-auto">
        {/* Left Section */}
        <div className="flex items-center gap-2 md:gap-4 min-w-0">
          <span className="text-on-surface font-bold tracking-tight font-mono text-xs md:text-sm lg:text-lg uppercase truncate">
            Shipyard
          </span>
          <nav className="hidden md:flex items-center gap-1">
            <Link to="/" className="text-on-surface-variant hover:text-on-surface hover:bg-surface-container px-1.5 py-0.5 rounded text-xs font-mono uppercase tracking-wide transition-colors">
              {t.dashboard}
            </Link>
            <Link to="/tasks" className="text-on-surface-variant hover:text-on-surface hover:bg-surface-container px-1.5 py-0.5 rounded text-xs font-mono uppercase tracking-wide transition-colors">
              {t.tasks}
            </Link>
            <Link to="/runs" className="text-on-surface-variant hover:text-on-surface hover:bg-surface-container px-1.5 py-0.5 rounded text-xs font-mono uppercase tracking-wide transition-colors">
              {t.runs}
            </Link>
          </nav>
        </div>

        {/* Right Section */}
        <div className="flex items-center gap-0.5 md:gap-2 shrink-0">
          {/* Search - only on tasks and runs pages */}
          {showSearch && (
            <div className="relative">
              <span className="material-symbols-outlined absolute left-1.5 top-1/2 -translate-y-1/2 text-on-surface-variant" style={{ fontSize: '14px' }}>
                search
              </span>
              <input
                type="text"
                id="search"
                name="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t.search}
                className="bg-surface-container-highest border border-outline-variant/20 rounded h-6 pl-5 pr-2 text-xs w-24 md:w-32 focus:ring-1 focus:ring-primary focus:outline-none font-mono text-on-surface placeholder:text-on-surface-variant/50"
              />
            </div>
          )}

          {/* Connection Status */}
          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-container">
            <div
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                isConnected ? 'bg-tertiary animate-pulse' : 'bg-error'
              }`}
            />
            <span className="text-[10px] font-mono text-on-surface-variant truncate max-w-12 sm:max-w-none">
              {isConnected ? t.connected : t.disconnected}
            </span>
          </div>

          {/* Notifications */}
          <div className="relative">
            <button
              onClick={togglePanel}
              className="p-1 rounded hover:bg-surface-container transition-colors relative"
              aria-label={t.notifications}
              aria-expanded={isPanelOpen}
              aria-haspopup="dialog"
            >
              <span className="material-symbols-outlined text-on-surface-variant" style={{ fontSize: '16px' }}>
                {unreadCount > 0 ? 'notifications_active' : 'notifications'}
              </span>
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-error text-on-error text-[7px] font-bold rounded-full flex items-center justify-center">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
            <NotificationPanel isOpen={isPanelOpen} onClose={closePanel} />
          </div>

          {/* Settings */}
          <Link to="/settings" className="p-1 rounded hover:bg-surface-container transition-colors">
            <span className="material-symbols-outlined text-on-surface-variant" style={{ fontSize: '16px' }}>settings</span>
          </Link>
        </div>
      </div>
    </header>
  );
}