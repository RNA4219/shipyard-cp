import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { LanguageProvider, useLanguage, useTranslation, getTranslations } from '../../contexts/LanguageContext';

// Test component to access language context
function TestComponent() {
  const { language, setLanguage, hasSelectedLanguage, markLanguageSelected } = useLanguage();
  const translations = useTranslation();

  return (
    <div>
      <span data-testid="language">{language}</span>
      <span data-testid="hasSelectedLanguage">{hasSelectedLanguage.toString()}</span>
      <span data-testid="dashboard-text">{translations.dashboard}</span>
      <button onClick={() => setLanguage('ja')} data-testid="set-ja">
        Set Japanese
      </button>
      <button onClick={() => setLanguage('en')} data-testid="set-en">
        Set English
      </button>
      <button onClick={markLanguageSelected} data-testid="mark-selected">
        Mark Selected
      </button>
    </div>
  );
}

describe('LanguageContext', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    window.localStorage.clear();
  });

  it('should provide default language as English', () => {
    render(
      <LanguageProvider>
        <TestComponent />
      </LanguageProvider>
    );

    expect(screen.getByTestId('language').textContent).toBe('en');
  });

  it('should change language when setLanguage is called', () => {
    render(
      <LanguageProvider>
        <TestComponent />
      </LanguageProvider>
    );

    expect(screen.getByTestId('language').textContent).toBe('en');
    expect(screen.getByTestId('dashboard-text').textContent).toBe('Dashboard');

    act(() => {
      fireEvent.click(screen.getByTestId('set-ja'));
    });

    expect(screen.getByTestId('language').textContent).toBe('ja');
    expect(screen.getByTestId('dashboard-text').textContent).toBe('ダッシュボード');
  });

  it('should persist language in localStorage', () => {
    render(
      <LanguageProvider>
        <TestComponent />
      </LanguageProvider>
    );

    act(() => {
      fireEvent.click(screen.getByTestId('set-ja'));
    });

    expect(window.localStorage.getItem('shipyard-language')).toBe('ja');
  });

  it('should load language from localStorage on init', () => {
    window.localStorage.setItem('shipyard-language', 'ja');

    render(
      <LanguageProvider>
        <TestComponent />
      </LanguageProvider>
    );

    expect(screen.getByTestId('language').textContent).toBe('ja');
  });

  it('should track hasSelectedLanguage', () => {
    render(
      <LanguageProvider>
        <TestComponent />
      </LanguageProvider>
    );

    expect(screen.getByTestId('hasSelectedLanguage').textContent).toBe('false');

    act(() => {
      fireEvent.click(screen.getByTestId('mark-selected'));
    });

    expect(screen.getByTestId('hasSelectedLanguage').textContent).toBe('true');
  });

  it('should persist language selection in localStorage', () => {
    render(
      <LanguageProvider>
        <TestComponent />
      </LanguageProvider>
    );

    act(() => {
      fireEvent.click(screen.getByTestId('mark-selected'));
    });

    expect(window.localStorage.getItem('shipyard-language-selected')).toBe('true');
  });

  it('should load hasSelectedLanguage from localStorage on init', () => {
    window.localStorage.setItem('shipyard-language-selected', 'true');

    render(
      <LanguageProvider>
        <TestComponent />
      </LanguageProvider>
    );

    expect(screen.getByTestId('hasSelectedLanguage').textContent).toBe('true');
  });

  it('should throw error when useLanguage is used outside provider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    function TestComponentOutsideProvider() {
      useLanguage();
      return null;
    }

    expect(() => render(<TestComponentOutsideProvider />)).toThrow(
      'useLanguage must be used within a LanguageProvider'
    );

    consoleError.mockRestore();
  });

  it('should throw error when useTranslation is used outside provider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    function TestComponentOutsideProvider() {
      useTranslation();
      return null;
    }

    expect(() => render(<TestComponentOutsideProvider />)).toThrow(
      'useLanguage must be used within a LanguageProvider'
    );

    consoleError.mockRestore();
  });
});

describe('getTranslations', () => {
  it('should return English translations', () => {
    const translations = getTranslations('en');
    expect(translations.dashboard).toBe('Dashboard');
    expect(translations.tasks).toBe('Tasks');
    expect(translations.settings).toBe('Settings');
  });

  it('should return Japanese translations', () => {
    const translations = getTranslations('ja');
    expect(translations.dashboard).toBe('ダッシュボード');
    expect(translations.tasks).toBe('タスク');
    expect(translations.settings).toBe('設定');
  });
});