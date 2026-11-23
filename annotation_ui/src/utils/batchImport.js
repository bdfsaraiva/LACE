/**
 * @fileoverview Helpers for importing many chat-room CSV files at once.
 *
 * The server caps how many files and how many megabytes one request may
 * carry (`GET /admin/import-limits`).  `chunkFiles` splits a selection into
 * requests that respect those caps, and `checkSelection` flags the files the
 * server would reject anyway (not a CSV, too large, or a room name that is
 * already taken), so they are never uploaded.
 */

/** Used until the server's limits have been fetched; match the backend defaults. */
export const DEFAULT_IMPORT_LIMITS = {
    max_file_mb: 10,
    max_rows: 50000,
    max_batch_files: 50,
    max_batch_mb: 50,
};

/**
 * Files per request, at most.  Each file is several database round trips,
 * so smaller requests keep every one well inside the request timeout and let
 * the UI report progress while a large selection is imported.
 */
export const FILES_PER_REQUEST = 10;

const MB = 1024 * 1024;

/**
 * Room name the server derives from a CSV filename: the name without `.csv`.
 * @param {string} filename
 * @returns {string}
 */
export const roomNameFromFilename = (filename) => filename.replace(/\.csv$/i, '').trim();

/**
 * Split files into request-sized groups.
 *
 * A group never holds more than `min(limits.max_batch_files, FILES_PER_REQUEST)`
 * files or more than `limits.max_batch_mb` megabytes.  Order is preserved.
 *
 * @param {File[]} files
 * @param {Object} limits - `ChatRoomImportLimits` from the server.
 * @returns {File[][]}
 */
export const chunkFiles = (files, limits = DEFAULT_IMPORT_LIMITS) => {
    const maxFiles = Math.max(1, Math.min(limits.max_batch_files, FILES_PER_REQUEST));
    const maxBytes = limits.max_batch_mb * MB;
    const chunks = [];
    let current = [];
    let currentBytes = 0;
    files.forEach((file) => {
        const full = current.length >= maxFiles || currentBytes + file.size > maxBytes;
        if (current.length > 0 && full) {
            chunks.push(current);
            current = [];
            currentBytes = 0;
        }
        current.push(file);
        currentBytes += file.size;
    });
    if (current.length > 0) chunks.push(current);
    return chunks;
};

/**
 * Check a selection locally before anything is uploaded.
 *
 * @param {File[]} files - The whole selection, in order.
 * @param {string[]} existingNames - Names of the project's chat rooms.
 * @param {Object} limits - `ChatRoomImportLimits` from the server.
 * @returns {Array<string|null>} For each file, why it cannot be imported, or `null`.
 */
export const checkSelection = (files, existingNames, limits = DEFAULT_IMPORT_LIMITS) => {
    const taken = new Set(existingNames);
    const seen = new Set();
    return files.map((file) => {
        if (!/\.csv$/i.test(file.name)) return 'Not a .csv file';
        const name = roomNameFromFilename(file.name);
        if (!name) return 'The filename does not give a room name';
        if (file.size > limits.max_file_mb * MB) return `Larger than the ${limits.max_file_mb} MB limit`;
        if (taken.has(name)) return `A chat room named '${name}' already exists in this project`;
        if (seen.has(name)) return `Another selected file is also named '${name}'`;
        seen.add(name);
        return null;
    });
};
