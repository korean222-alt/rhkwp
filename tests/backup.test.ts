import { describe, it, expect } from 'vitest';
import { validateManifest } from '../src/lib/backup-schema';
import { crc32 } from '../src/lib/backup-zip';
import { folderContains, folderPath } from '../src/lib/folders';
import { DEFAULT_SETTINGS } from '../src/types';
const manifest = () => ({ format: 'lecturelens-backup', version: 1, appVersion: '1.3.0', createdAt: 1,
  settings: DEFAULT_SETTINGS, folders: [], sessions: [{ id: 's', name: '강의', createdAt: 1, updatedAt: 1, status: 'complete', duration: 5, settings: DEFAULT_SETTINGS, source: 'screen', bytes: 0 }],
  transcripts: [], frames: [], chunks: [], attachments: [] });
describe('portable backup input validation', () => {
  it('accepts a v1.3 backup without changing its image preferences', () => {
    const legacy = { ...DEFAULT_SETTINGS, schemaVersion: 3, width: 960, quality: .7 };
    const restored = validateManifest({ ...manifest(), settings: legacy, sessions: manifest().sessions.map(s => ({ ...s, settings: legacy })) });
    expect(restored.settings.width).toBe(960); expect(restored.sessions[0].settings.quality).toBe(.7);
  });
  it('accepts the portable schema but rejects keys, versions and extra payloads', () => {
    expect(validateManifest(manifest()).sessions).toHaveLength(1);
    expect(() => validateManifest({ ...manifest(), version: 99 })).toThrow();
    expect(() => validateManifest({ ...manifest(), apiKey: 'not-a-real-key' })).toThrow();
    expect(() => validateManifest({ ...manifest(), settings: { ...DEFAULT_SETTINGS, key: 'not-a-real-key' } })).toThrow();
  });
  it('rejects cyclic folders, dangling parents, duplicate IDs and orphan records', () => {
    expect(() => validateManifest({ ...manifest(), folders: [{ id: 'a', name: 'a', parentId: 'b', createdAt: 1 }, { id: 'b', name: 'b', parentId: 'a', createdAt: 1 }] })).toThrow(/폴더/);
    expect(() => validateManifest({ ...manifest(), folders: [{ id: 'a', name: 'a', parentId: 'missing', createdAt: 1 }] })).toThrow();
    expect(() => validateManifest({ ...manifest(), sessions: [...manifest().sessions, ...manifest().sessions] })).toThrow(/중복/);
    expect(() => validateManifest({ ...manifest(), transcripts: [{ id: 't', sessionId: 'absent', start: 0, end: 1, text: '자막' }] })).toThrow();
  });
  it('rejects path traversal, invalid samples, active file types and backwards timestamps', () => {
    expect(() => validateManifest({ ...manifest(), attachments: [{ path: '../secret', bytes: 4, sha256: 'a'.repeat(64), mime: 'image/png' }] })).toThrow();
    expect(() => validateManifest({ ...manifest(), transcripts: [{ id: 't', sessionId: 's', start: 4, end: 1, text: '자막' }] })).toThrow();
    expect(() => validateManifest({ ...manifest(), chunks: [{ id: 'c', sessionId: 's', start: 0, duration: 5, status: 'pending', samples: 'data/1.f32' }], attachments: [{ path: 'data/1.f32', bytes: 4, sha256: 'a'.repeat(64), mime: 'application/x-float32-le' }] })).toThrow(/오디오/);
    expect(() => validateManifest({ ...manifest(), attachments: [{ path: 'data/1.png', bytes: 4, sha256: 'a'.repeat(64), mime: 'image/svg+xml' }] })).toThrow();
  });
  it('checks ZIP CRC against a standard vector', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
  it('keeps hierarchy paths and nested filtering consistent', () => {
    const folders = [{ id: 'a', name: '2학기', createdAt: 1 }, { id: 'b', name: '경제학', parentId: 'a', createdAt: 1 }];
    expect(folderPath('b', folders)).toBe('2학기 / 경제학'); expect(folderContains('a', 'b', folders)).toBe(true);
    expect(folderContains('b', 'a', folders)).toBe(false); expect(folderPath(undefined, folders)).toBe('미분류');
  });
});
