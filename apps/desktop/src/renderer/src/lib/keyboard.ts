export function isEditableHistoryShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  return Boolean(target.closest('input, textarea, select, [contenteditable]'));
}

export function isPlainSpaceKey(event: KeyboardEvent): boolean {
  return (event.code === 'Space' || event.key === ' ' || event.key === 'Spacebar')
    && !event.altKey
    && !event.ctrlKey
    && !event.metaKey;
}

export function isPlaybackShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  return Boolean(target.closest('input, textarea, select, button, [contenteditable], [role="button"], [role="slider"], [role="dialog"]'));
}
