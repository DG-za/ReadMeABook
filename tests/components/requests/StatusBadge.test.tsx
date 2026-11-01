/**
 * Component: Status Badge Tests
 * Documentation: documentation/frontend/components.md
 */

// @vitest-environment jsdom

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusBadge } from '@/components/requests/StatusBadge';

describe('StatusBadge', () => {
  it.each([
    [null, 'Awaiting Search'],
    ['2026-11-01T12:00:00Z', 'No Suitable Match'],
  ])('distinguishes an unsearched request from an unsuccessful search at %s', (lastSearchAt, label) => {
    render(<StatusBadge status="awaiting_search" lastSearchAt={lastSearchAt} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('does not treat a disabled ebook source attempt as a completed search', () => {
    render(<StatusBadge
      status="awaiting_search"
      lastSearchAt="2026-11-01T12:00:00Z"
      errorMessage="No ebook sources enabled. Enable Anna's Archive or Indexer Search in settings."
    />);
    expect(screen.getByText('Awaiting Search')).toBeInTheDocument();
    expect(screen.queryByText('No Suitable Match')).toBeNull();
  });

  it('keeps the current status when a previous search timestamp remains', () => {
    render(<StatusBadge status="searching" lastSearchAt="2026-11-01T12:00:00Z" />);
    expect(screen.getByText('Searching...')).toBeInTheDocument();
    expect(screen.queryByText('No Suitable Match')).toBeNull();
  });

  it('uses the initializing label for zero-progress downloads', () => {
    render(<StatusBadge status="downloading" progress={0} />);
    expect(screen.getByText('Initializing...')).toBeInTheDocument();
  });

  it('falls back to the raw status when unknown', () => {
    render(<StatusBadge status="custom_status" />);
    expect(screen.getByText('custom_status')).toBeInTheDocument();
  });

  it('renders the awaiting_release label with teal styling', () => {
    render(<StatusBadge status="awaiting_release" />);
    const badge = screen.getByText('Awaiting Release');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('bg-teal-100');
    expect(badge.className).toContain('text-teal-800');
    expect(badge.className).toContain('dark:bg-teal-900');
    expect(badge.className).toContain('dark:text-teal-200');
  });
});
