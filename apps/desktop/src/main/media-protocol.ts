import { protocol } from 'electron';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { mediaContentType } from './media-types';

export type MediaSourceResolver = (jobId: string) => string | null;

type ByteRange = { start: number; end: number };

export function registerMediaSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'voxmire-media',
      privileges: {
        secure: true,
        standard: true,
        stream: true,
        supportFetchAPI: true
      }
    }
  ]);
}

export function registerMediaProtocol(resolveSourcePath: MediaSourceResolver): void {
  protocol.handle('voxmire-media', (request) => {
    const jobId = mediaJobIdFromUrl(request.url);
    if (!jobId) {
      return new Response('Invalid media URL.', { status: 400 });
    }

    const sourcePath = resolveSourcePath(jobId);
    if (!sourcePath) {
      return new Response('Media job not found.', { status: 404 });
    }

    return streamMediaFile(request, sourcePath);
  });
}

export function mediaSourceUrl(jobId: string): string {
  return `voxmire-media://job/${encodeURIComponent(jobId)}`;
}

function streamMediaFile(request: Request, sourcePath: string): Response {
  if (!existsSync(sourcePath)) {
    return new Response('Media source unavailable.', { status: 404 });
  }

  const stats = statSync(sourcePath);
  if (!stats.isFile()) {
    return new Response('Media source unavailable.', { status: 404 });
  }

  const fileSize = stats.size;
  const contentType = mediaContentType(sourcePath);
  const range = parseRangeHeader(request.headers.get('range'), fileSize);
  if (range === 'unsatisfiable') {
    return new Response(null, {
      status: 416,
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes */${fileSize}`
      }
    });
  }

  const baseHeaders = {
    'Accept-Ranges': 'bytes',
    'Content-Type': contentType
  };

  if (!range) {
    return new Response(request.method === 'HEAD' ? null : nodeReadableToWeb(createReadStream(sourcePath)), {
      status: 200,
      headers: {
        ...baseHeaders,
        'Content-Length': fileSize.toString()
      }
    });
  }

  const contentLength = range.end - range.start + 1;
  return new Response(request.method === 'HEAD' ? null : nodeReadableToWeb(createReadStream(sourcePath, { start: range.start, end: range.end })), {
    status: 206,
    headers: {
      ...baseHeaders,
      'Content-Length': contentLength.toString(),
      'Content-Range': `bytes ${range.start}-${range.end}/${fileSize}`
    }
  });
}

function nodeReadableToWeb(stream: NodeJS.ReadableStream): ReadableStream<Uint8Array> {
  return Readable.toWeb(stream as Readable) as ReadableStream<Uint8Array>;
}

function parseRangeHeader(header: string | null, fileSize: number): ByteRange | 'unsatisfiable' | null {
  if (!header) {
    return null;
  }

  const match = /^bytes=(?<start>\d*)-(?<end>\d*)$/.exec(header.trim());
  if (!match?.groups) {
    return 'unsatisfiable';
  }

  const startText = match.groups.start;
  const endText = match.groups.end;
  if (!startText && !endText) {
    return 'unsatisfiable';
  }

  let start: number;
  let end: number;
  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return 'unsatisfiable';
    }

    start = Math.max(0, fileSize - suffixLength);
    end = fileSize - 1;
  } else {
    start = Number(startText);
    end = endText ? Number(endText) : fileSize - 1;
  }

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= fileSize) {
    return 'unsatisfiable';
  }

  return { start, end: Math.min(end, fileSize - 1) };
}

function mediaJobIdFromUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'voxmire-media:' || url.hostname !== 'job') {
      return null;
    }

    const jobId = decodeURIComponent(url.pathname.replace(/^\//, ''));
    return jobId.length > 0 ? jobId : null;
  } catch {
    return null;
  }
}
