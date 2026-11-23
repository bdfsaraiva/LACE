import { describe, it, expect } from 'vitest';
import { chunkFiles, checkSelection, roomNameFromFilename, FILES_PER_REQUEST } from './batchImport';

const MB = 1024 * 1024;
const file = (name, size = 100) => ({ name, size });
const limits = { max_file_mb: 10, max_rows: 50000, max_batch_files: 50, max_batch_mb: 50 };

describe('roomNameFromFilename', () => {
    it('drops the extension case-insensitively', () => {
        expect(roomNameFromFilename('Sala 1.CSV')).toBe('Sala 1');
    });
});

describe('chunkFiles', () => {
    it('caps the number of files per request', () => {
        const files = Array.from({ length: 25 }, (_, i) => file(`f${i}.csv`));
        const chunks = chunkFiles(files, limits);
        expect(chunks.map((c) => c.length)).toEqual([FILES_PER_REQUEST, FILES_PER_REQUEST, 5]);
        expect(chunks.flat()).toEqual(files);
    });

    it('respects a server file limit below the default', () => {
        const files = Array.from({ length: 5 }, (_, i) => file(`f${i}.csv`));
        expect(chunkFiles(files, { ...limits, max_batch_files: 2 }).map((c) => c.length)).toEqual([2, 2, 1]);
    });

    it('caps the combined size per request', () => {
        const files = [file('a.csv', 8 * MB), file('b.csv', 8 * MB), file('c.csv', 8 * MB)];
        const chunks = chunkFiles(files, { ...limits, max_batch_mb: 20 });
        expect(chunks.map((c) => c.map((f) => f.name))).toEqual([['a.csv', 'b.csv'], ['c.csv']]);
    });

    it('returns no chunks for no files', () => {
        expect(chunkFiles([], limits)).toEqual([]);
    });
});

describe('checkSelection', () => {
    it('flags non-CSV, oversized, taken and repeated names', () => {
        const files = [
            file('ok.csv'),
            file('notes.txt'),
            file('big.csv', 11 * MB),
            file('exists.csv'),
            file('ok.csv'),
        ];
        const problems = checkSelection(files, ['exists'], limits);
        expect(problems[0]).toBeNull();
        expect(problems[1]).toMatch(/csv/i);
        expect(problems[2]).toMatch(/10 MB/);
        expect(problems[3]).toMatch(/already exists/);
        expect(problems[4]).toMatch(/also named/);
    });
});
