import { type CSSProperties, type ReactElement, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';

type ProjectActionsMenuProps = {
  onDelete: () => void;
  onDetails: () => void;
  onRename: () => void;
  renderInPortal?: boolean;
};

type PopoverPosition = {
  left: number;
  top: number;
};

export function ProjectActionsMenu({ onDelete, onDetails, onRename, renderInPortal = false }: ProjectActionsMenuProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState<PopoverPosition | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const updatePopoverPosition = useCallback((trigger: HTMLButtonElement | null = triggerRef.current) => {
    if (!trigger || !renderInPortal) {
      return;
    }

    const triggerRect = trigger.getBoundingClientRect();
    const popoverWidth = 178;
    const popoverHeight = 126;
    const viewportPadding = 8;

    setPopoverPosition({
      left: Math.max(viewportPadding, Math.min(triggerRect.right - popoverWidth, window.innerWidth - popoverWidth - viewportPadding)),
      top: Math.max(viewportPadding, Math.min(triggerRect.bottom + viewportPadding, window.innerHeight - popoverHeight - viewportPadding))
    });
  }, [renderInPortal]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }

    function handlePointerDown(event: MouseEvent): void {
      const target = event.target as Node;

      if ((menuRef.current && menuRef.current.contains(target)) || (popoverRef.current && popoverRef.current.contains(target))) {
        return;
      }

      setOpen(false);
    }

    function handlePositionChange(): void {
      updatePopoverPosition();
    }

    updatePopoverPosition();
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('resize', handlePositionChange);
    window.addEventListener('scroll', handlePositionChange, true);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('resize', handlePositionChange);
      window.removeEventListener('scroll', handlePositionChange, true);
    };
  }, [open, updatePopoverPosition]);

  const popoverStyle: CSSProperties | undefined = renderInPortal && popoverPosition
    ? {
        left: `${popoverPosition.left}px`,
        position: 'fixed',
        right: 'auto',
        top: `${popoverPosition.top}px`
      }
    : undefined;

  const popover = (
    <div className="project-action-popover" ref={popoverRef} role="menu" style={popoverStyle}>
      <button
        onClick={(event) => {
          event.stopPropagation();
          setOpen(false);
          onDetails();
        }}
        role="menuitem"
        type="button"
      >
        <Info size={14} />
        <span>Details</span>
      </button>
      <button
        onClick={(event) => {
          event.stopPropagation();
          setOpen(false);
          onRename();
        }}
        role="menuitem"
        type="button"
      >
        <Pencil size={14} />
        <span>Rename</span>
      </button>
      <button
        className="danger-menu-item"
        onClick={(event) => {
          event.stopPropagation();
          setOpen(false);
          onDelete();
        }}
        role="menuitem"
        type="button"
      >
        <Trash2 size={14} />
        <span>Delete project</span>
      </button>
    </div>
  );

  return (
    <div className="project-action-menu" ref={menuRef}>
      <button
        aria-expanded={open}
        aria-label="Project actions"
        className={`icon-button project-action-trigger ${open ? 'active' : ''}`}
        onClick={(event) => {
          event.stopPropagation();
          updatePopoverPosition(event.currentTarget);
          setOpen((current) => !current);
        }}
        ref={triggerRef}
        title="Project actions"
        type="button"
      >
        <MoreHorizontal size={16} />
      </button>
      {open ? renderInPortal && typeof document !== 'undefined' ? createPortal(popover, document.body) : popover : null}
    </div>
  );
}
