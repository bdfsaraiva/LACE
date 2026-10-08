/**
 * @fileoverview Regression tests for the 401 handling in the axios response
 * interceptor of `api.js`.
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

import './api';

const responseErrorHandler = mockApi.interceptors.response.use.mock.calls[0][1];

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

    it('passes a failed login through to the caller without refreshing', async () => {
        localStorage.setItem('refresh_token', 'old-refresh');
        const error = unauthorized('/auth/token');

        await expect(responseErrorHandler(error)).rejects.toBe(error);
        expect(mockRefreshPost).not.toHaveBeenCalled();
        expect(localStorage.getItem('refresh_token')).toBe('old-refresh');
    });

    it('shares one refresh call between concurrent 401s and keeps the rotated refresh token', async () => {
        localStorage.setItem('access_token', 'expired-access');
        localStorage.setItem('refresh_token', 'old-refresh');
        mockRefreshPost.mockResolvedValue({
            data: { access_token: 'new-access', refresh_token: 'new-refresh' },
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
    });
});
