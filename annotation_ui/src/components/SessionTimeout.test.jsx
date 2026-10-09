import { render, screen, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import SessionTimeout from './SessionTimeout';

const { mockLogout, mockRenewSession } = vi.hoisted(() => ({
  mockLogout: vi.fn(() => Promise.resolve()),
  mockRenewSession: vi.fn(),
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: true, logout: mockLogout }),
}));

vi.mock('../utils/api', () => ({
  auth: { renewSession: mockRenewSession },
}));

const NOW_MS = Date.UTC(2026, 0, 1, 12, 0, 0);

/** Store a session end `seconds` from the (fake) current time. */
const setSessionEndIn = (seconds) => {
  localStorage.setItem('session_expires_at', String(NOW_MS / 1000 + seconds));
};

describe('SessionTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
    localStorage.clear();
    mockLogout.mockClear();
    mockRenewSession.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the countdown banner only in the last two minutes', () => {
    setSessionEndIn(125);
    render(<SessionTimeout />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(5000); });

    // 120 s left; the logout happens 10 s before the end, so 110 s are shown.
    expect(screen.getByRole('alert')).toHaveTextContent('Your session will end in 110 seconds');
    expect(screen.getByRole('button', { name: 'Renew session' })).toBeInTheDocument();
  });

  it('renews the session for another full period', async () => {
    setSessionEndIn(60);
    mockRenewSession.mockImplementation(async () => setSessionEndIn(3600));
    render(<SessionTimeout />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Renew session' }));
    });

    expect(mockRenewSession).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(120_000); });
    expect(mockLogout).not.toHaveBeenCalled();
  });

  it('saves and logs out once, shortly before the session ends', () => {
    setSessionEndIn(15);
    render(<SessionTimeout />);
    expect(mockLogout).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(5000); });

    expect(mockLogout).toHaveBeenCalledWith({ sessionExpired: true });
    expect(screen.getByRole('alert')).toHaveTextContent('Saving your work and signing out');
    act(() => { vi.advanceTimersByTime(5000); });
    expect(mockLogout).toHaveBeenCalledTimes(1);
  });

  it('logs out when the session end is missing, e.g. after another tab logged out', () => {
    render(<SessionTimeout />);
    expect(mockLogout).toHaveBeenCalledWith({ sessionExpired: true });
  });
});
