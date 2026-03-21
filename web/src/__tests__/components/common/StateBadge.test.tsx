import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StateBadge, RiskBadge } from '../../../components/common/StateBadge';
import { LanguageProvider } from '../../../contexts/LanguageContext';
import type { TaskState } from '../../../types';

// Wrapper with LanguageProvider for translations
const renderWithProviders = (ui: React.ReactElement) => {
  return render(
    <LanguageProvider>
      {ui}
    </LanguageProvider>
  );
};

describe('StateBadge', () => {
  it('should render with default size sm', () => {
    renderWithProviders(<StateBadge state="queued" />);

    const badge = screen.getByText('Queued');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('text-[10px]');
  });

  it('should render with size md', () => {
    renderWithProviders(<StateBadge state="queued" size="md" />);

    const badge = screen.getByText('Queued');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('text-xs');
  });

  it('should apply custom className', () => {
    renderWithProviders(<StateBadge state="queued" className="custom-class" />);

    const badge = screen.getByText('Queued');
    expect(badge.className).toContain('custom-class');
  });

  it('should render animated indicator for active states', () => {
    renderWithProviders(<StateBadge state="planning" />);

    const badge = screen.getByText('Planning');
    const pulseIndicator = badge.querySelector('.animate-pulse');
    expect(pulseIndicator).toBeInTheDocument();
  });

  it('should not render animated indicator for non-active states', () => {
    renderWithProviders(<StateBadge state="queued" />);

    const badge = screen.getByText('Queued');
    const pulseIndicator = badge.querySelector('.animate-pulse');
    expect(pulseIndicator).not.toBeInTheDocument();
  });

  describe('state labels', () => {
    const testCases: { state: TaskState; expectedLabel: string }[] = [
      { state: 'queued', expectedLabel: 'Queued' },
      { state: 'planning', expectedLabel: 'Planning' },
      { state: 'planned', expectedLabel: 'Planned' },
      { state: 'developing', expectedLabel: 'Developing' },
      { state: 'dev_completed', expectedLabel: 'Dev Done' },
      { state: 'accepting', expectedLabel: 'Accepting' },
      { state: 'accepted', expectedLabel: 'Accepted' },
      { state: 'rework_required', expectedLabel: 'Rework' },
      { state: 'integrating', expectedLabel: 'Integrating' },
      { state: 'integrated', expectedLabel: 'Integrated' },
      { state: 'publish_pending_approval', expectedLabel: 'Awaiting Approval' },
      { state: 'publishing', expectedLabel: 'Publishing' },
      { state: 'published', expectedLabel: 'Published' },
      { state: 'cancelled', expectedLabel: 'Cancelled' },
      { state: 'failed', expectedLabel: 'Failed' },
      { state: 'blocked', expectedLabel: 'Blocked' },
    ];

    testCases.forEach(({ state, expectedLabel }) => {
      it(`should render "${expectedLabel}" for state "${state}"`, () => {
        renderWithProviders(<StateBadge state={state} />);
        expect(screen.getByText(expectedLabel)).toBeInTheDocument();
      });
    });
  });

  describe('state colors', () => {
    it('should apply error color for failed state', () => {
      renderWithProviders(<StateBadge state="failed" />);

      const badge = screen.getByText('Failed');
      expect(badge.className).toContain('text-error');
      expect(badge.className).toContain('bg-error/10');
    });

    it('should apply primary color for developing state', () => {
      renderWithProviders(<StateBadge state="developing" />);

      const badge = screen.getByText('Developing');
      expect(badge.className).toContain('text-primary');
    });

    it('should apply tertiary color for published state', () => {
      renderWithProviders(<StateBadge state="published" />);

      const badge = screen.getByText('Published');
      expect(badge.className).toContain('text-tertiary');
    });
  });
});

describe('RiskBadge', () => {
  it('should render low risk badge', () => {
    renderWithProviders(<RiskBadge risk="low" />);

    const badge = screen.getByText('Low');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('text-tertiary');
  });

  it('should render medium risk badge', () => {
    renderWithProviders(<RiskBadge risk="medium" />);

    const badge = screen.getByText('Medium');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('text-secondary');
  });

  it('should render high risk badge', () => {
    renderWithProviders(<RiskBadge risk="high" />);

    const badge = screen.getByText('High');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('text-error');
  });

  it('should apply custom className', () => {
    renderWithProviders(<RiskBadge risk="low" className="custom-class" />);

    const badge = screen.getByText('Low');
    expect(badge.className).toContain('custom-class');
  });
});