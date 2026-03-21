import { memo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

export const FAB = memo(function FAB() {
  const navigate = useNavigate();

  const handleClick = useCallback(() => {
    navigate('/tasks/new');
  }, [navigate]);

  return (
    <button
      onClick={handleClick}
      className="fixed bottom-6 right-6 w-14 h-14 bg-gradient-to-br from-primary to-primary-container rounded-xl flex items-center justify-center shadow-xl shadow-primary/30 hover:scale-105 active:scale-95 transition-transform z-50"
      title="Deploy Agent"
    >
      <span className="material-symbols-outlined text-on-primary-fixed text-2xl">bolt</span>
    </button>
  );
});