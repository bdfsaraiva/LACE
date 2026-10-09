/**
 * @fileoverview Session-expiry warning banner and automatic logout.
 *
 * Sessions have an absolute lifetime set by the backend (`SESSION_EXPIRE_MINUTES`,
 * 60 by default), counted from login or from the last renewal.  The session
 * end is kept in `localStorage` (`session_expires_at`, Unix seconds) and is
 * re-read every second, so every tab follows the same session and the
 * countdown stays correct after the computer sleeps.
 *
 * - `WARNING_SECONDS` before the end, a banner counts down to the logout and
 *   offers "Renew session", which extends the session by another full period.
 * - `SAVE_LEAD_SECONDS` before the end — while the tokens are still valid —
 *   pending work is saved and the user is logged out (see `AuthContext.logout`).
 */
import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { auth } from '../utils/api';
import './SessionTimeout.css';

/** Seconds before the session end at which the warning banner appears. */
const WARNING_SECONDS = 120;

/**
 * Seconds before the session end at which pending work is saved and the user
 * is logged out, leaving the saves time to finish while the tokens still work.
 */
const SAVE_LEAD_SECONDS = 10;

/**
 * Seconds until the stored session end (0 when there is no session end, e.g.
 * after another tab logged out).
 * @returns {number}
 */
const readSecondsLeft = () => {
    const sessionExpiresAt = Number(localStorage.getItem('session_expires_at'));
    return sessionExpiresAt ? Math.floor(sessionExpiresAt - Date.now() / 1000) : 0;
};

/**
 * Renders nothing until the session is about to end, then a banner with a
 * countdown and a "Renew session" button.  Logs the user out automatically
 * when the countdown reaches zero.
 */
const SessionTimeout = () => {
    const { isAuthenticated, logout } = useAuth();
    const [secondsLeft, setSecondsLeft] = useState(null);
    const [isEnding, setIsEnding] = useState(false);
    const [isRenewing, setIsRenewing] = useState(false);
    const [renewError, setRenewError] = useState(null);

    useEffect(() => {
        if (!isAuthenticated) {
            setSecondsLeft(null);
            setIsEnding(false);
            return undefined;
        }
        setSecondsLeft(readSecondsLeft());
        const intervalId = setInterval(() => setSecondsLeft(readSecondsLeft()), 1000);
        return () => clearInterval(intervalId);
    }, [isAuthenticated]);

    useEffect(() => {
        if (!isAuthenticated || isEnding || secondsLeft === null || secondsLeft > SAVE_LEAD_SECONDS) return;
        // Stays set until the logout completes and isAuthenticated turns false,
        // so the logout is started only once.
        setIsEnding(true);
        logout({ sessionExpired: true });
    }, [isAuthenticated, isEnding, secondsLeft, logout]);

    /** Extend the session by another full period. */
    const handleRenew = async () => {
        setIsRenewing(true);
        setRenewError(null);
        try {
            await auth.renewSession();
            setSecondsLeft(readSecondsLeft());
        } catch (err) {
            setRenewError('Could not renew the session. Please try again.');
        } finally {
            setIsRenewing(false);
        }
    };

    if (!isAuthenticated || secondsLeft === null || secondsLeft > WARNING_SECONDS) {
        return null;
    }

    const isSigningOut = isEnding || secondsLeft <= SAVE_LEAD_SECONDS;
    const secondsToSignOut = Math.max(secondsLeft - SAVE_LEAD_SECONDS, 0);

    return (
        <div className="session-timeout-banner" role="alert">
            {isSigningOut ? (
                <span className="session-timeout-text">Saving your work and signing out…</span>
            ) : (
                <>
                    <span className="session-timeout-text">
                        Your session will end in{' '}
                        <strong aria-live="off">{secondsToSignOut} seconds</strong>.
                        {' '}Your work will be saved before you are signed out.
                    </span>
                    <button
                        type="button"
                        className="session-timeout-renew"
                        onClick={handleRenew}
                        disabled={isRenewing}
                    >
                        {isRenewing ? 'Renewing…' : 'Renew session'}
                    </button>
                </>
            )}
            {renewError && !isSigningOut && (
                <span className="session-timeout-error">{renewError}</span>
            )}
        </div>
    );
};

export default SessionTimeout;
