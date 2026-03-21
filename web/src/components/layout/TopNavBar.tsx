import { Link } from 'react-router-dom';
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

  return (
    <header className="fixed top-0 left-16 right-0 z-40 h-10 px-4 border-b border-outline-variant/20 bg-surface-container-lowest/80 backdrop-blur-md shadow-sm shadow-black/10">
      <div className="flex items-center justify-between h-full">
        {/* Left Section */}
        <div className="flex items-center gap-6">
          <span className="text-on-surface font-bold tracking-tight font-mono text-xs uppercase">
            Shipyard CP
          </span>
          <nav className="hidden md:flex items-center gap-1">
            <Link to="/" className="text-on-surface-variant hover:text-on-surface hover:bg-surface-container px-2 py-1 rounded text-xs font-mono uppercase tracking-wide transition-colors">
              {t.dashboard}
            </Link>
            <Link to="/tasks" className="text-on-surface-variant hover:text-on-surface hover:bg-surface-container px-2 py-1 rounded text-xs font-mono uppercase tracking-wide transition-colors">
              {t.tasks}
            </Link>
            <Link to="/runs" className="text-on-surface-variant hover:text-on-surface hover:bg-surface-container px-2 py-1 rounded text-xs font-mono uppercase tracking-wide transition-colors">
              {t.runs}
            </Link>
          </nav>
        </div>

        {/* Right Section */}
        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative">
            <span className="material-symbols-outlined absolute left-2 top-1/2 -translate-y-1/2 text-on-surface-variant text-sm">
              search
            </span>
            <input
              type="text"
              id="search"
              name="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t.search}
              className="bg-surface-container-highest border border-outline-variant/20 rounded h-6 pl-7 pr-2 text-[11px] w-48 focus:ring-1 focus:ring-primary focus:outline-none font-mono text-on-surface placeholder:text-on-surface-variant/50"
            />
          </div>

          {/* Connection Status */}
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-surface-container">
            <div
              className={`w-2 h-2 rounded-full ${
                isConnected ? 'bg-tertiary animate-pulse' : 'bg-error'
              }`}
            />
            <span className="text-[10px] font-mono text-on-surface-variant">
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
              <span className="material-symbols-outlined text-on-surface-variant">
                {unreadCount > 0 ? 'notifications_active' : 'notifications'}
              </span>
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-error text-on-error text-[9px] font-bold rounded-full flex items-center justify-center">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
            <NotificationPanel isOpen={isPanelOpen} onClose={closePanel} />
          </div>

          {/* Settings */}
          <Link to="/settings" className="p-1 rounded hover:bg-surface-container transition-colors">
            <span className="material-symbols-outlined text-on-surface-variant">settings</span>
          </Link>

          {/* Profile */}
          <button className="w-6 h-6 rounded-full bg-secondary-container flex items-center justify-center">
            <span className="material-symbols-outlined text-on-secondary-container text-sm">person</span>
          </button>
        </div>
      </div>
    </header>
  );
}