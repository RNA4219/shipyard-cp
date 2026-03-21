import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { LoadingSpinner, LoadingPage } from '../../../components/common/LoadingSpinner';

describe('LoadingSpinner', () => {
  it('should render with default size md', () => {
    const { container } = render(<LoadingSpinner />);

    const spinner = container.querySelector('svg');
    expect(spinner).toBeInTheDocument();
    const classList = spinner?.getAttribute('class') || '';
    expect(classList).toContain('h-6');
    expect(classList).toContain('w-6');
  });

  it('should render with size sm', () => {
    const { container } = render(<LoadingSpinner size="sm" />);

    const spinner = container.querySelector('svg');
    const classList = spinner?.getAttribute('class') || '';
    expect(classList).toContain('h-4');
    expect(classList).toContain('w-4');
  });

  it('should render with size lg', () => {
    const { container } = render(<LoadingSpinner size="lg" />);

    const spinner = container.querySelector('svg');
    const classList = spinner?.getAttribute('class') || '';
    expect(classList).toContain('h-8');
    expect(classList).toContain('w-8');
  });

  it('should have animate-spin class', () => {
    const { container } = render(<LoadingSpinner />);

    const spinner = container.querySelector('svg');
    const classList = spinner?.getAttribute('class') || '';
    expect(classList).toContain('animate-spin');
  });

  it('should have default blue color', () => {
    const { container } = render(<LoadingSpinner />);

    const spinner = container.querySelector('svg');
    const classList = spinner?.getAttribute('class') || '';
    expect(classList).toContain('text-blue-500');
  });

  it('should apply custom className', () => {
    const { container } = render(<LoadingSpinner className="text-red-500" />);

    const spinner = container.querySelector('svg');
    const classList = spinner?.getAttribute('class') || '';
    expect(classList).toContain('text-red-500');
  });

  it('should render SVG with correct attributes', () => {
    const { container } = render(<LoadingSpinner />);

    const spinner = container.querySelector('svg');
    expect(spinner?.tagName.toLowerCase()).toBe('svg');
    expect(spinner).toHaveAttribute('xmlns', 'http://www.w3.org/2000/svg');
    expect(spinner).toHaveAttribute('fill', 'none');
    expect(spinner).toHaveAttribute('viewBox', '0 0 24 24');
  });

  it('should contain circle and path elements', () => {
    const { container } = render(<LoadingSpinner />);

    const svg = container.querySelector('svg');
    expect(svg?.querySelector('circle')).toBeInTheDocument();
    expect(svg?.querySelector('path')).toBeInTheDocument();
  });
});

describe('LoadingPage', () => {
  it('should render a centered loading spinner', () => {
    const { container } = render(<LoadingPage />);

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('flex');
    expect(wrapper.className).toContain('items-center');
    expect(wrapper.className).toContain('justify-center');
    expect(wrapper.className).toContain('h-64');
  });

  it('should contain a LoadingSpinner with lg size', () => {
    const { container } = render(<LoadingPage />);

    const spinner = container.querySelector('svg');
    expect(spinner).toBeInTheDocument();
    const classList = spinner?.getAttribute('class') || '';
    expect(classList).toContain('h-8');
    expect(classList).toContain('w-8');
  });
});