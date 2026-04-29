export type MediaKind = 'audio' | 'video';

export function mediaKindLabel(kind: MediaKind): string {
  return kind === 'video' ? 'video' : 'audio';
}

export function mediaKindFromExtension(extension: string): MediaKind {
  switch (extension.toLowerCase().replace(/^\./, '')) {
    case 'mp4':
    case 'mov':
    case 'mkv':
    case 'webm':
    case 'avi':
      return 'video';
    default:
      return 'audio';
  }
}
