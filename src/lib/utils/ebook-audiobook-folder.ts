/**
 * Component: Existing Audiobook Folder For Ebook Imports
 * Documentation: documentation/integrations/ebook-sidecar.md
 */

import fs from 'fs/promises';
import path from 'path';
import { prisma } from '../db';
import { AUDIO_EXTENSIONS, EBOOK_EXTENSIONS, PLEX_COMPATIBLE_EXTENSIONS, TRANSCODE_REQUIRED_EXTENSIONS } from '../constants/audio-formats';
import { getLibraryService } from '../services/library';
import { getConfigService } from '../services/config.service';

type Book = {
  id: string;
  filePath?: string | null;
  fileFormat?: string | null;
  absItemId?: string | null;
  plexGuid?: string | null;
  audibleAsin?: string | null;
};

export type AudiobookFolder = { path: string; format: string; identity: string };

const LIBRARY_AUDIO_EXTENSIONS = new Set<string>([
  ...AUDIO_EXTENSIONS, ...PLEX_COMPATIBLE_EXTENSIONS, ...TRANSCODE_REQUIRED_EXTENSIONS,
  '.aiff', '.aif', '.oga', '.webm',
]);

async function audioNames(dir: string, depth = 1): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const names = entries.filter((entry) => entry.isFile() && !entry.name.startsWith('.') &&
    LIBRARY_AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())).map((entry) => entry.name);
  if (depth > 0) {
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        names.push(...await audioNames(path.join(dir, entry.name), depth - 1));
      }
    }
  }
  return names;
}

async function audioFolder(candidate: string, preferredFormat?: string | null): Promise<AudiobookFolder | null> {
  let stat;
  try {
    stat = await fs.stat(candidate);
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return null;
    throw error;
  }
  const dir = stat.isDirectory() ? candidate : path.dirname(candidate);
  if (!stat.isDirectory() && !LIBRARY_AUDIO_EXTENSIONS.has(path.extname(candidate).toLowerCase())) return null;
  const audio = await audioNames(dir);
  if (!audio.length) return null;
  const formats = audio.map((name) => path.extname(name).slice(1).toLowerCase());
  const counts = new Map<string, number>();
  for (const format of formats) counts.set(format, (counts.get(format) ?? 0) + 1);
  const format = preferredFormat && counts.has(preferredFormat.toLowerCase())
    ? preferredFormat.toLowerCase()
    : [...counts].sort((a, b) => b[1] - a[1])[0][0];
  const directoryStat = stat.isDirectory() ? stat : await fs.stat(dir);
  return {
    path: dir,
    format,
    identity: `${directoryStat.dev}:${directoryStat.ino}`,
  };
}

async function requireUnsharedFolder(folder: AudiobookFolder, bookId: string): Promise<AudiobookFolder> {
  const others = await prisma.audiobook.findMany({
    where: { id: { not: bookId }, filePath: { not: null } },
    select: { filePath: true },
  });
  for (const other of others ?? []) {
    if (!other.filePath) continue;
    const existing = await audioFolder(other.filePath);
    if (existing?.identity === folder.identity) {
      throw new Error(`Cannot attach ebook: audiobook folder is shared with another book: ${folder.path}`);
    }
  }
  return folder;
}

export async function findAudiobookFolderForEbook(book: Book): Promise<AudiobookFolder | null> {
  if (book.filePath) {
    const recorded = await audioFolder(book.filePath, book.fileFormat);
    if (recorded) return requireUnsharedFolder(recorded, book.id);
  }

  const ids = [book.absItemId, book.plexGuid].filter((id): id is string => Boolean(id));
  if (!ids.length && !book.audibleAsin) return null;
  if (await getConfigService().getBackendMode() !== 'audiobookshelf') return null;
  const matches = await prisma.plexLibrary.findMany({
    where: { OR: [
      ...(ids.length ? [{ plexGuid: { in: ids } }] : []),
      ...(book.audibleAsin ? [{ asin: book.audibleAsin }] : []),
    ] },
    select: { plexGuid: true, plexRatingKey: true, filePath: true, duration: true },
  });
  const linked = (matches ?? []).filter((match) => ids.includes(match.plexGuid));
  const candidates = linked.length ? linked : matches ?? [];
  if (!candidates.length) return null;

  const folders = new Map<string, AudiobookFolder>();
  for (const candidate of candidates) {
    let candidatePath = candidate.filePath;
    let liveAudio = false;
    if (!candidatePath) {
      const library = await getLibraryService();
      const item = await library.getItem(candidate.plexRatingKey || candidate.plexGuid);
      liveAudio = Boolean(item);
      candidatePath = item?.filePath ?? null;
    }
    const folder = candidatePath ? await audioFolder(candidatePath, book.fileFormat) : null;
    if (!folder && !liveAudio && candidate.duration === 0n && !ids.includes(candidate.plexGuid) && candidatePath) {
      const names = await fs.readdir(candidatePath).catch(() => []);
      if (names.some((name) => (EBOOK_EXTENSIONS as readonly string[]).includes(path.extname(name).toLowerCase()))) continue;
    }
    if (!folder) {
      throw new Error(`Cannot attach ebook: library audiobook folder is unavailable. Mount its library path in ReadMeABook: ${candidatePath ?? candidate.plexGuid}`);
    }
    folders.set(folder.identity, folder);
  }
  if (!folders.size) return null;
  if (folders.size !== 1) {
    throw new Error('Cannot attach ebook: more than one audiobook folder matches its ASIN');
  }
  return requireUnsharedFolder([...folders.values()][0], book.id);
}
