import { type ReactElement, useEffect, useRef, useState } from 'react';
import { Info, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';

type ProjectActionsMenuProps = {
  onDelete: () => void;
  onDetails: () => void;
  onRename: () => void;
};

export function ProjectActionsMenu({ onDelete, onDetails, onRename }: ProjectActionsMenuProps): ReactElement {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

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
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mousedown', handlePointerDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousedown', handlePointerDown);
    };
  }, [open]);

  return (
    <div className="project-action-menu" ref={menuRef}>
      <button
        aria-expanded={open}
        aria-label="Project actions"
        className={`icon-button project-action-trigger ${open ? 'active' : ''}`}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
        title="Project actions"
        type="button"
      >
        <MoreHorizontal size={16} />
      </button>
      {open ? (
        <div className="project-action-popover" role="menu">
          <button
            onClick={() => {
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
            onClick={() => {
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
            onClick={() => {
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
      ) : null}
    </div>
  );
}
