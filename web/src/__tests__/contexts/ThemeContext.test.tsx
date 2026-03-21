import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ThemeProvider, useTheme, customThemePresets } from '../../contexts/ThemeContext';

// Test component to access theme context
function TestComponent() {
  const { theme, setTheme, resolvedTheme, customColors, setCustomColors } = useTheme();

  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="resolved-theme">{resolvedTheme}</span>
      <span data-testid="custom-colors">{customColors ? 'custom' : 'none'}</span>
      <button onClick={() => setTheme('dark')} data-testid="set-dark">
        Set Dark
      </button>
      <button onClick={() => setTheme('light')} data-testid="set-light">
        Set Light
      </button>
      <button onClick={() => setTheme('system')} data-testid="set-system">
        Set System
      </button>
      <button onClick={() => setTheme('custom')} data-testid="set-custom">
        Set Custom
      </button>
      <button
        onClick={() => setCustomColors(customThemePresets.cobaltNeon as Parameters<typeof setCustomColors>[0])}
        data-testid="set-custom-colors"
      >
        Set Custom Colors
      </button>
    </div>
  );
}

describe('ThemeContext', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    window.localStorage.clear();
    // Reset document.documentElement attributes
    document.documentElement.removeAttribute('data-theme');
  });

  it('should provide default theme as dark', () => {
    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    expect(screen.getByTestId('theme').textContent).toBe('dark');
    expect(screen.getByTestId('resolved-theme').textContent).toBe('dark');
  });

  it('should change theme when setTheme is called', () => {
    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    expect(screen.getByTestId('theme').textContent).toBe('dark');

    act(() => {
      fireEvent.click(screen.getByTestId('set-light'));
    });

    expect(screen.getByTestId('theme').textContent).toBe('light');
    expect(screen.getByTestId('resolved-theme').textContent).toBe('light');
  });

  it('should persist theme in localStorage', () => {
    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    act(() => {
      fireEvent.click(screen.getByTestId('set-light'));
    });

    expect(window.localStorage.getItem('shipyard-theme')).toBe('light');
  });

  it('should load theme from localStorage on init', () => {
    window.localStorage.setItem('shipyard-theme', 'light');

    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    expect(screen.getByTestId('theme').textContent).toBe('light');
  });

  it('should set data-theme attribute on document element', () => {
    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    act(() => {
      fireEvent.click(screen.getByTestId('set-light'));
    });

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('should handle system theme', () => {
    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    act(() => {
      fireEvent.click(screen.getByTestId('set-system'));
    });

    expect(screen.getByTestId('theme').textContent).toBe('system');
    // Resolved theme should be based on matchMedia mock (returns false, so light)
    // But our mock returns matches: false, which means light theme
    // However, getSystemTheme defaults to dark when window is undefined
    // In the test environment, it will use matchMedia which returns false
    expect(screen.getByTestId('resolved-theme').textContent).toBe('light');
  });

  it('should handle custom theme', () => {
    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    act(() => {
      fireEvent.click(screen.getByTestId('set-custom'));
    });

    expect(screen.getByTestId('theme').textContent).toBe('custom');
    expect(document.documentElement.getAttribute('data-theme')).toBe('custom');
  });

  it('should set custom colors', () => {
    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    act(() => {
      fireEvent.click(screen.getByTestId('set-custom'));
    });

    expect(screen.getByTestId('custom-colors').textContent).toBe('none');

    act(() => {
      fireEvent.click(screen.getByTestId('set-custom-colors'));
    });

    expect(screen.getByTestId('custom-colors').textContent).toBe('custom');
    expect(window.localStorage.getItem('shipyard-custom-colors')).toBeDefined();
  });

  it('should load custom colors from localStorage on init', () => {
    const customColors = JSON.stringify(customThemePresets.cobaltNeon);
    window.localStorage.setItem('shipyard-custom-colors', customColors);

    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    // Just verify it loads without error - custom colors state is internal
    expect(screen.getByTestId('custom-colors').textContent).toBe('custom');
  });

  it('should throw error when useTheme is used outside provider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    function TestComponentOutsideProvider() {
      useTheme();
      return null;
    }

    expect(() => render(<TestComponentOutsideProvider />)).toThrow(
      'useTheme must be used within a ThemeProvider'
    );

    consoleError.mockRestore();
  });
});

describe('customThemePresets', () => {
  it('should contain cobaltNeon preset', () => {
    expect(customThemePresets.cobaltNeon).toBeDefined();
    expect(customThemePresets.cobaltNeon.primary).toBe('#00d4ff');
    expect(customThemePresets.cobaltNeon.background).toBe('#0a0a1a');
  });

  it('should contain forest preset', () => {
    expect(customThemePresets.forest).toBeDefined();
    expect(customThemePresets.forest.primary).toBe('#4ade80');
  });

  it('should contain sunset preset', () => {
    expect(customThemePresets.sunset).toBeDefined();
    expect(customThemePresets.sunset.primary).toBe('#f97316');
  });
});