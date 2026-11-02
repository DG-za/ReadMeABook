/**
 * Component: Ebook Attachment Folder Tests
 * Documentation: documentation/integrations/ebook-sidecar.md
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const prismaMock = vi.hoisted(() => ({
  audiobook: { findMany: vi.fn() },
  plexLibrary: { findMany: vi.fn() },
}));
const libraryMock = vi.hoisted(() => ({ getItem: vi.fn() }));
const configMock = vi.hoisted(() => ({ getBackendMode: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/library', () => ({ getLibraryService: async () => libraryMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configMock }));
import { findAudiobookFolderForEbook } from '@/lib/utils/ebook-audiobook-folder';

let root: string;
async function folder(name: string, filename = 'Book.m4b') {
  const dir = path.join(root, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, filename), 'content');
  return dir;
}
const book = { id: 'book', audibleAsin: 'B012345678' };

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'rmab-ebook-folder-'));
  prismaMock.audiobook.findMany.mockResolvedValue([]);
  prismaMock.plexLibrary.findMany.mockResolvedValue([]);
  configMock.getBackendMode.mockResolvedValue('audiobookshelf');
});
afterEach(async () => fs.rm(root, { recursive: true, force: true }));

describe('ebook audiobook folder', () => {
  it('keeps the old audiobook folder after template or series changes', async () => {
    const original = await folder('Author/Book B012345678');
    expect(await findAudiobookFolderForEbook({ ...book, filePath: original })).toMatchObject({ path: original, format: 'm4b' });
    expect(prismaMock.plexLibrary.findMany).not.toHaveBeenCalled();
  });

  it('keeps a multidisc book folder when its audio is in immediate child folders', async () => {
    const disc = await folder('Book/CD1', '01.mp3');
    const original = path.dirname(disc);
    expect(await findAudiobookFolderForEbook({ ...book, filePath: original })).toMatchObject({ path: original, format: 'mp3' });
    prismaMock.plexLibrary.findMany.mockResolvedValue([{ plexGuid: 'abs-id', filePath: original, duration: 1000n }]);
    expect(await findAudiobookFolderForEbook(book)).toMatchObject({ path: original, format: 'mp3' });
  });

  it('retains the stored audio format when other audio formats are also present', async () => {
    const original = await folder('Book', 'z.m4b');
    await fs.writeFile(path.join(original, 'a.mp3'), 'audio');
    expect(await findAudiobookFolderForEbook({ ...book, filePath: original, fileFormat: 'm4b' })).toMatchObject({ format: 'm4b' });
  });

  it.each(['opus', 'aac', 'wav', 'wma'])('attaches to existing library %s audio', async (format) => {
    const original = await folder('Library book', `Book.${format}`);
    expect(await findAudiobookFolderForEbook({ ...book, filePath: original })).toMatchObject({ path: original, format });
  });

  it('finds an existing library audiobook by exact ASIN for an ebook-only request', async () => {
    const original = await folder('Humanities/Author/Book');
    prismaMock.plexLibrary.findMany.mockResolvedValue([{ plexGuid: 'abs-id', filePath: original, duration: 1000n }]);
    expect(await findAudiobookFolderForEbook(book)).toMatchObject({ path: original });
    expect(prismaMock.plexLibrary.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { OR: [{ asin: book.audibleAsin }] } }));
  });

  it('reads the library item when older cache rows have no stored file path', async () => {
    const original = await folder('Legacy library/Author/Book');
    prismaMock.plexLibrary.findMany.mockResolvedValue([{ plexGuid: 'abs-id', filePath: null, duration: 1000n }]);
    libraryMock.getItem.mockResolvedValue({ filePath: original });
    expect(await findAudiobookFolderForEbook(book)).toMatchObject({ path: original });
    expect(libraryMock.getItem).toHaveBeenCalledWith('abs-id');
  });

  it.each([0n, null])('attaches real audio when cached duration is %s', async (duration) => {
    const original = await folder('No duration metadata');
    prismaMock.plexLibrary.findMany.mockResolvedValue([{ plexGuid: 'abs-id', filePath: null, duration }]);
    libraryMock.getItem.mockResolvedValue({ filePath: original });
    expect(await findAudiobookFolderForEbook({ ...book, absItemId: 'abs-id' })).toMatchObject({ path: original });
    expect(await findAudiobookFolderForEbook(book)).toMatchObject({ path: original });
  });

  it('keeps Plex standalone imports on their existing template path', async () => {
    configMock.getBackendMode.mockResolvedValue('plex');
    expect(await findAudiobookFolderForEbook(book)).toBeNull();
    expect(libraryMock.getItem).not.toHaveBeenCalled();
  });

  it('recovers from an ebook having overwritten the shared book path and format', async () => {
    const original = await folder('Old audiobook');
    const split = await folder('New ebook', 'Book.epub');
    prismaMock.plexLibrary.findMany.mockResolvedValue([{ plexGuid: 'abs-id', filePath: original, duration: 1000n }]);
    expect(await findAudiobookFolderForEbook({ ...book, filePath: split })).toMatchObject({ path: original, format: 'm4b' });
  });

  it('uses the linked library item when multiple editions share an ASIN', async () => {
    const wanted = await folder('Wanted');
    const other = await folder('Other');
    prismaMock.plexLibrary.findMany.mockResolvedValue([
      { plexGuid: 'wanted', filePath: wanted, duration: 1000n },
      { plexGuid: 'other', filePath: other, duration: 1000n },
    ]);
    expect(await findAudiobookFolderForEbook({ ...book, absItemId: 'wanted' })).toMatchObject({ path: wanted });
    await expect(findAudiobookFolderForEbook(book)).rejects.toThrow('more than one audiobook folder');
  });

  it('stops when the matching library path is not mounted instead of splitting the book', async () => {
    prismaMock.plexLibrary.findMany.mockResolvedValue([{ plexGuid: 'abs-id', filePath: path.join(root, 'unmounted'), duration: 1000n }]);
    await expect(findAudiobookFolderForEbook(book)).rejects.toThrow('Mount its library path');
  });

  it('does not treat zero-duration live audio with a missing mount as a standalone ebook', async () => {
    prismaMock.plexLibrary.findMany.mockResolvedValue([{ plexGuid: 'abs-id', filePath: null, duration: 0n }]);
    libraryMock.getItem.mockResolvedValue({ filePath: path.join(root, 'unmounted') });
    await expect(findAudiobookFolderForEbook(book)).rejects.toThrow('Mount its library path');
  });

  it('rejects a folder shared with another book', async () => {
    const shared = await folder('Author');
    prismaMock.audiobook.findMany.mockResolvedValue([{ filePath: shared }]);
    await expect(findAudiobookFolderForEbook({ ...book, filePath: shared })).rejects.toThrow('shared with another book');
  });

  it('uses the containing folder when the library caches an audio filename', async () => {
    const original = await folder('Book');
    prismaMock.plexLibrary.findMany.mockResolvedValue([{ plexGuid: 'plex-id', filePath: path.join(original, 'Book.m4b'), duration: 1000n }]);
    expect(await findAudiobookFolderForEbook(book)).toMatchObject({ path: original });
  });

  it('leaves standalone ebooks on the template path and ignores ebook-only cache rows', async () => {
    const standalone = await folder('Ebook', 'Book.epub');
    prismaMock.plexLibrary.findMany.mockResolvedValue([{ plexGuid: 'ebook-id', filePath: standalone, duration: 0n }]);
    expect(await findAudiobookFolderForEbook({ ...book, filePath: standalone })).toBeNull();
  });
});
