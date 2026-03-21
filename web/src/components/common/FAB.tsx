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
      className="fixed bottom-3 right-3 w-10 h-10 bg-gradient-to-br from-primary to-primary-container rounded-lg flex items-center justify-center shadow-xl shadow-primary/30 hover:scale-105 active:scale-95 transition-transform z-50"
      title="Deploy Agent"
    >
      <span className="material-symbols-outlined text-on-primary-fixed" style={{ fontSize: '20px' }}>bolt</span>
    </button>
  );
});