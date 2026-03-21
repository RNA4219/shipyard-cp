import { memo } from 'react';
import { Outlet } from 'react-router-dom';
import { SideNavBar } from './SideNavBar';
import { TopNavBar } from './TopNavBar';

export const MainLayout = memo(function MainLayout() {
  return (
    <div className="h-screen bg-background overflow-hidden">
      <SideNavBar />
      <TopNavBar />
      <main className="ml-14 mt-14 h-[calc(100vh-3.5rem)] overflow-auto">
        <Outlet />
      </main>
    </div>
  );
});