import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import Home from './page';

// Basic wrapper simulation for testing if Next requires special context
// We are trusting jsdom to be setup globally.

describe('Home Page Layout', () => {
  it('mounts the application hero title', () => {
    // Basic structural test
    render(<Home />);
    
    // Validate text rendering
    const heading = screen.getByText(/Understand Any Document/i);
    expect(heading).not.toBeNull();
  });

  it('renders the interactive document upload zone', () => {
    render(<Home />);
    const uploadText = screen.getByText(/Drop your document here/i);
    expect(uploadText).not.toBeNull();
  });
});
