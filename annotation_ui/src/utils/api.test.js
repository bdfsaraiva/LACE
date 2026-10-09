/**
 * @fileoverview Regression tests for the interceptors of `api.js`: 401
 * handling, token refresh, and tracking of in-flight write requests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Replaces the global axios mock from setupTests.js: the retry path calls the
// axios instance as a function, so the mocked instance must be callable.
const { mockApi, mockRefreshPost } = vi.hoisted(() => {
    const instance = vi.fn();
    instance.interceptors = { request: { use: vi.fn() }, response: { use: vi.fn() } };
    return { mockApi: instance, mockRefreshPost: vi.fn() };
});

vi.mock('axios', () => ({
    default: { create: vi.fn(() => mockApi), post: mockRefreshPost },
}));

import { waitForPendingWrites } from './api';

const requestHandler = mockApi.interceptors.request.use.mock.calls[0][0];
const [responseSuccessHandler, responseErrorHandler] = mockApi.interceptors.response.use.mock.calls[0];

const unauthorized = (url) => ({
    config: { url, headers: {} },
    response: { status: 401, data: { detail: 'Incorrect username or password' } },
});

describe('api response interceptor', () => {
    beforeEach(() => {
        localStorage.clear();
        mockApi.mockReset();
        mockRefreshPost.mockReset();
    });

    it.each(['/auth/token', '/auth/refresh'])(
        'passes a 401 from %s through to the caller without refreshing',
        async (url) => {
            localStorage.setItem('refresh_token', 'old-refresh');
            const error = unauthorized(url);

            await expect(responseErrorHandler(error)).rejects.toBe(error);
            expect(mockRefreshPost).not.toHaveBeenCalled();
            expect(localStorage.getItem('refresh_token')).toBe('old-refresh');
        }
    );

    it('shares one refresh call between concurrent 401s and stores the rotated tokens and session end', async () => {
        localStorage.setItem('access_token', 'expired-access');
        localStorage.setItem('refresh_token', 'old-refresh');
        mockRefreshPost.mockResolvedValue({
            data: { access_token: 'new-access', refresh_token: 'new-refresh', session_expires_at: 1767268800 },
        });
        mockApi.mockResolvedValue({ data: 'ok' });

        await Promise.all([
            responseErrorHandler(unauthorized('/projects/')),
            responseErrorHandler(unauthorized('/auth/me')),
        ]);

        expect(mockRefreshPost).toHaveBeenCalledTimes(1);
        expect(mockApi).toHaveBeenCalledTimes(2);
        for (const [retriedRequest] of mockApi.mock.calls) {
            expect(retriedRequest.headers.Authorization).toBe('Bearer new-access');
        }
        expect(localStorage.getItem('access_token')).toBe('new-access');
        expect(localStorage.getItem('refresh_token')).toBe('new-refresh');
        expect(localStorage.getItem('session_expires_at')).toBe('1767268800');
    });
});

describe('waitForPendingWrites', () => {
    it('resolves only after every in-flight write has settled', async () => {
        const save = requestHandler({ method: 'post', headers: {} });
        const failedSave = requestHandler({ method: 'put', headers: {} });
        requestHandler({ method: 'get', headers: {} });
        let settled = false;
        const waiting = waitForPendingWrites().then(() => { settled = true; });

        responseSuccessHandler({ config: save });
        await Promise.resolve();
        expect(settled).toBe(false);

        await expect(
            responseErrorHandler({ config: failedSave, response: { status: 500 } })
        ).rejects.toBeDefined();
        await waiting;
        expect(settled).toBe(true);
    });

    it('resolves immediately when nothing is in flight', async () => {
        await expect(waitForPendingWrites()).resolves.toBeUndefined();
    });
});
