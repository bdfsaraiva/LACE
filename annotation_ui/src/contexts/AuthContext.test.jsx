import { render, screen, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext';

const { mockAuthLogout, mockWaitForPendingWrites } = vi.hoisted(() => ({
  mockAuthLogout: vi.fn(),
  mockWaitForPendingWrites: vi.fn(),
}));

vi.mock('../utils/api', () => ({
  auth: { logout: mockAuthLogout, getCurrentUser: vi.fn() },
  waitForPendingWrites: mockWaitForPendingWrites,
}));

/** Login route that shows whether it was reached through a session expiry. */
const LoginRoute = () => (
  <p>{useLocation().state?.sessionExpired ? 'login: session expired' : 'login'}</p>
);

let logoutFromContext;

/** A page with a field that saves on blur, like the question-analysis label. */
const EditorRoute = ({ onBlur }) => {
  logoutFromContext = useAuth().logout;
  return <input aria-label="label" onBlur={onBlur} />;
};

describe('AuthContext logout', () => {
  beforeEach(() => {
    localStorage.clear();
    mockAuthLogout.mockClear();
    mockWaitForPendingWrites.mockReset();
  });

  it('saves the focused field and waits for pending saves before dropping the tokens', async () => {
    const onBlur = vi.fn();
    let resolvePendingWrites;
    mockWaitForPendingWrites.mockReturnValue(new Promise((resolve) => { resolvePendingWrites = resolve; }));
    render(
      <MemoryRouter initialEntries={['/room']}>
        <AuthProvider>
          <Routes>
            <Route path="/room" element={<EditorRoute onBlur={onBlur} />} />
            <Route path="/login" element={<LoginRoute />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );
    screen.getByLabelText('label').focus();

    let logoutDone;
    await act(async () => {
      logoutDone = logoutFromContext({ sessionExpired: true });
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(onBlur).toHaveBeenCalledTimes(1);
    expect(mockWaitForPendingWrites).toHaveBeenCalledTimes(1);
    expect(mockAuthLogout).not.toHaveBeenCalled();

    await act(async () => {
      resolvePendingWrites();
      await logoutDone;
    });

    expect(mockAuthLogout).toHaveBeenCalledTimes(1);
    expect(screen.getByText('login: session expired')).toBeInTheDocument();
  });
});
