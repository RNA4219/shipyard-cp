import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StateBadge, RiskBadge } from '../../../components/common/StateBadge';
import type { TaskState, RiskLevel } from '../../../types';

describe('StateBadge', () => {
  it('should render with default size sm', () => {
    render(<StateBadge state="queued" />);

    const badge = screen.getByText('QUEUED');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('text-[10px]');
  });

  it('should render with size md', () => {
    render(<StateBadge state="queued" size="md" />);

    const badge = screen.getByText('QUEUED');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('text-xs');
  });

  it('should apply custom className', () => {
    render(<StateBadge state="queued" className="custom-class" />);

    const badge = screen.getByText('QUEUED');
    expect(badge.className).toContain('custom-class');
  });

  it('should render animated indicator for active states', () => {
    render(<StateBadge state="planning" />);

    const badge = screen.getByText('PLANNING');
    const pulseIndicator = badge.querySelector('.animate-pulse');
    expect(pulseIndicator).toBeInTheDocument();
  });

  it('should not render animated indicator for non-active states', () => {
    render(<StateBadge state="queued" />);

    const badge = screen.getByText('QUEUED');
    const pulseIndicator = badge.querySelector('.animate-pulse');
    expect(pulseIndicator).not.toBeInTheDocument();
  });

  describe('state labels', () => {
    const testCases: { state: TaskState; expectedLabel: string }[] = [
      { state: 'queued', expectedLabel: 'QUEUED' },
      { state: 'planning', expectedLabel: 'PLANNING' },
      { state: 'planned', expectedLabel: 'PLANNED' },
      { state: 'developing', expectedLabel: 'DEVELOPING' },
      { state: 'dev_completed', expectedLabel: 'DEV DONE' },
      { state: 'accepting', expectedLabel: 'ACCEPTING' },
      { state: 'accepted', expectedLabel: 'ACCEPTED' },
      { state: 'rework_required', expectedLabel: 'REWORK' },
      { state: 'integrating', expectedLabel: 'INTEGRATING' },
      { state: 'integrated', expectedLabel: 'INTEGRATED' },
      { state: 'publish_pending_approval', expectedLabel: 'AWAITING APPROVAL' },
      { state: 'publishing', expectedLabel: 'PUBLISHING' },
      { state: 'published', expectedLabel: 'PUBLISHED' },
      { state: 'cancelled', expectedLabel: 'CANCELLED' },
      { state: 'failed', expectedLabel: 'FAILED' },
      { state: 'blocked', expectedLabel: 'BLOCKED' },
    ];

    testCases.forEach(({ state, expectedLabel }) => {
      it(`should render "${expectedLabel}" for state "${state}"`, () => {
        render(<StateBadge state={state} />);
        expect(screen.getByText(expectedLabel)).toBeInTheDocument();
      });
    });
  });

  describe('state colors', () => {
    it('should apply error color for failed state', () => {
      render(<StateBadge state="failed" />);

      const badge = screen.getByText('FAILED');
      expect(badge.className).toContain('text-error');
      expect(badge.className).toContain('bg-error/10');
    });

    it('should apply primary color for developing state', () => {
      render(<StateBadge state="developing" />);

      const badge = screen.getByText('DEVELOPING');
      expect(badge.className).toContain('text-primary');
    });

    it('should apply tertiary color for published state', () => {
      render(<StateBadge state="published" />);

      const badge = screen.getByText('PUBLISHED');
      expect(badge.className).toContain('text-tertiary');
    });
  });
});

describe('RiskBadge', () => {
  it('should render low risk badge', () => {
    render(<RiskBadge risk="low" />);

    const badge = screen.getByText('LOW');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('text-tertiary');
  });

  it('should render medium risk badge', () => {
    render(<RiskBadge risk="medium" />);

    const badge = screen.getByText('MEDIUM');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('text-secondary');
  });

  it('should render high risk badge', () => {
    render(<RiskBadge risk="high" />);

    const badge = screen.getByText('HIGH');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('text-error');
  });

  it('should apply custom className', () => {
    render(<RiskBadge risk="low" className="custom-class" />);

    const badge = screen.getByText('LOW');
    expect(badge.className).toContain('custom-class');
  });
});