import { createContext, useContext, useEffect, useState, useCallback } from 'react';

export type ThemeMode = 'dark' | 'light' | 'system' | 'custom';

export interface CustomThemeColors {
  primary: string;
  primaryDim: string;
  primaryContainer: string;
  onPrimary: string;
  onPrimaryContainer: string;
  secondary: string;
  secondaryDim: string;
  secondaryContainer: string;
  onSecondary: string;
  onSecondaryContainer: string;
  tertiary: string;
  tertiaryDim: string;
  tertiaryContainer: string;
  onTertiary: string;
  onTertiaryContainer: string;
  error: string;
  errorContainer: string;
  onError: string;
  onErrorContainer: string;
  background: string;
  surface: string;
  surfaceDim: string;
  surfaceBright: string;
  surfaceContainer: string;
  surfaceContainerLow: string;
  surfaceContainerHigh: string;
  surfaceContainerHighest: string;
  surfaceContainerLowest: string;
  onSurface: string;
  onSurfaceVariant: string;
  outline: string;
  outlineVariant: string;
}

interface ThemeContextValue {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  customColors: CustomThemeColors | null;
  setCustomColors: (colors: CustomThemeColors) => void;
  resolvedTheme: 'dark' | 'light';
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = 'shipyard-theme';
const CUSTOM_COLORS_KEY = 'shipyard-custom-colors';

// Custom theme presets
// eslint-disable-next-line react-refresh/only-export-components
export const customThemePresets: Record<string, Partial<CustomThemeColors>> = {
  cobaltNeon: {
    primary: '#00d4ff',
    primaryDim: '#00a8cc',
    primaryContainer: '#003d4d',
    onPrimary: '#000000',
    onPrimaryContainer: '#00d4ff',
    secondary: '#ff00ff',
    secondaryDim: '#cc00cc',
    secondaryContainer: '#4d004d',
    onSecondary: '#ffffff',
    onSecondaryContainer: '#ff99ff',
    background: '#0a0a1a',
    surface: '#0f0f2a',
    surfaceDim: '#050510',
    surfaceBright: '#1a1a3a',
    surfaceContainer: '#12122a',
    surfaceContainerLow: '#0e0e22',
    surfaceContainerHigh: '#161634',
    surfaceContainerHighest: '#1c1c40',
    surfaceContainerLowest: '#000005',
    onSurface: '#e0e0ff',
    onSurfaceVariant: '#a0a0cc',
    outline: '#4040a0',
    outlineVariant: '#202060',
  },
  forest: {
    primary: '#4ade80',
    primaryDim: '#22c55e',
    primaryContainer: '#14532d',
    onPrimary: '#000000',
    onPrimaryContainer: '#4ade80',
    secondary: '#a78bfa',
    secondaryDim: '#8b5cf6',
    secondaryContainer: '#4c1d95',
    onSecondary: '#ffffff',
    onSecondaryContainer: '#c4b5fd',
    background: '#0f1a0f',
    surface: '#1a2a1a',
    surfaceDim: '#0a150a',
    surfaceBright: '#2a3a2a',
    surfaceContainer: '#1e2e1e',
    surfaceContainerLow: '#162616',
    surfaceContainerHigh: '#243424',
    surfaceContainerHighest: '#2a3a2a',
    surfaceContainerLowest: '#050a05',
    onSurface: '#e0f0e0',
    onSurfaceVariant: '#a0c0a0',
    outline: '#408040',
    outlineVariant: '#206020',
  },
  sunset: {
    primary: '#f97316',
    primaryDim: '#ea580c',
    primaryContainer: '#7c2d12',
    onPrimary: '#ffffff',
    onPrimaryContainer: '#fed7aa',
    secondary: '#ec4899',
    secondaryDim: '#db2777',
    secondaryContainer: '#831843',
    onSecondary: '#ffffff',
    onSecondaryContainer: '#fbcfe8',
    background: '#1a0f0f',
    surface: '#2a1a1a',
    surfaceDim: '#150a0a',
    surfaceBright: '#3a2a2a',
    surfaceContainer: '#2e1e1e',
    surfaceContainerLow: '#261616',
    surfaceContainerHigh: '#342424',
    surfaceContainerHighest: '#3a2a2a',
    surfaceContainerLowest: '#0a0505',
    onSurface: '#f0e0e0',
    onSurfaceVariant: '#c0a0a0',
    outline: '#804040',
    outlineVariant: '#602020',
  },
};

function getSystemTheme(): 'dark' | 'light' {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getInitialResolvedTheme(theme: ThemeMode): 'dark' | 'light' {
  if (theme === 'system') return getSystemTheme();
  if (theme === 'custom') return 'dark';
  return theme;
}

function applyThemeColors(colors: CustomThemeColors) {
  const root = document.documentElement;
  root.style.setProperty('--color-primary', colors.primary);
  root.style.setProperty('--color-primary-dim', colors.primaryDim);
  root.style.setProperty('--color-primary-container', colors.primaryContainer);
  root.style.setProperty('--color-on-primary', colors.onPrimary);
  root.style.setProperty('--color-on-primary-container', colors.onPrimaryContainer);
  root.style.setProperty('--color-secondary', colors.secondary);
  root.style.setProperty('--color-secondary-dim', colors.secondaryDim);
  root.style.setProperty('--color-secondary-container', colors.secondaryContainer);
  root.style.setProperty('--color-on-secondary', colors.onSecondary);
  root.style.setProperty('--color-on-secondary-container', colors.onSecondaryContainer);
  root.style.setProperty('--color-tertiary', colors.tertiary);
  root.style.setProperty('--color-tertiary-dim', colors.tertiaryDim);
  root.style.setProperty('--color-tertiary-container', colors.tertiaryContainer);
  root.style.setProperty('--color-on-tertiary', colors.onTertiary);
  root.style.setProperty('--color-on-tertiary-container', colors.onTertiaryContainer);
  root.style.setProperty('--color-error', colors.error);
  root.style.setProperty('--color-error-container', colors.errorContainer);
  root.style.setProperty('--color-on-error', colors.onError);
  root.style.setProperty('--color-on-error-container', colors.onErrorContainer);
  root.style.setProperty('--color-background', colors.background);
  root.style.setProperty('--color-surface', colors.surface);
  root.style.setProperty('--color-surface-dim', colors.surfaceDim);
  root.style.setProperty('--color-surface-bright', colors.surfaceBright);
  root.style.setProperty('--color-surface-container', colors.surfaceContainer);
  root.style.setProperty('--color-surface-container-low', colors.surfaceContainerLow);
  root.style.setProperty('--color-surface-container-high', colors.surfaceContainerHigh);
  root.style.setProperty('--color-surface-container-highest', colors.surfaceContainerHighest);
  root.style.setProperty('--color-surface-container-lowest', colors.surfaceContainerLowest);
  root.style.setProperty('--color-on-surface', colors.onSurface);
  root.style.setProperty('--color-on-surface-variant', colors.onSurfaceVariant);
  root.style.setProperty('--color-outline', colors.outline);
  root.style.setProperty('--color-outline-variant', colors.outlineVariant);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') return 'dark';
    const stored = localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
    return stored || 'dark';
  });

  const [customColors, setCustomColorsState] = useState<CustomThemeColors | null>(() => {
    if (typeof window === 'undefined') return null;
    const stored = localStorage.getItem(CUSTOM_COLORS_KEY);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        return null;
      }
    }
    return null;
  });

  const [resolvedTheme, setResolvedTheme] = useState<'dark' | 'light'>(() => getInitialResolvedTheme(theme));

  const setTheme = useCallback((newTheme: ThemeMode) => {
    setThemeState(newTheme);
    localStorage.setItem(STORAGE_KEY, newTheme);
  }, []);

  const setCustomColors = useCallback((colors: CustomThemeColors) => {
    setCustomColorsState(colors);
    localStorage.setItem(CUSTOM_COLORS_KEY, JSON.stringify(colors));
  }, []);

  // Apply theme on change - use layoutEffect to avoid flicker
  useEffect(() => {
    const root = document.documentElement;
    let newResolved: 'dark' | 'light';

    if (theme === 'system') {
      newResolved = getSystemTheme();
      root.setAttribute('data-theme', newResolved);
    } else if (theme === 'custom') {
      newResolved = 'dark'; // Custom themes are typically dark-based
      root.setAttribute('data-theme', 'custom');
      if (customColors) {
        applyThemeColors(customColors);
      }
    } else {
      newResolved = theme;
      root.setAttribute('data-theme', theme);
    }

    // Only update state if changed - this is intentional and safe
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setResolvedTheme(prev => prev === newResolved ? prev : newResolved);
  }, [theme, customColors]);

  // Listen for system theme changes
  useEffect(() => {
    if (theme !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      const system = getSystemTheme();
      setResolvedTheme(system);
      document.documentElement.setAttribute('data-theme', system);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, customColors, setCustomColors, resolvedTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}