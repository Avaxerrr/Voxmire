import { type ReactElement } from 'react';
import { Pencil, SkipBack, SkipForward } from 'lucide-react';
import { SearchField } from '../../components/search-field';

type FindReplacePanelProps = {
  activeFindIndex: number;
  findMatchCount: number;
  findMatchIndexesCount: number;
  findQuery: string;
  onFindQueryChange: (query: string) => void;
  onJumpMatch: (direction: 'previous' | 'next') => void;
  onReplaceAll: () => void;
  onReplaceQueryChange: (query: string) => void;
  onToggleReplacePanel: () => void;
  replacePanelOpen: boolean;
  replaceQuery: string;
  replacingText: boolean;
};

export function FindReplacePanel({
  activeFindIndex,
  findMatchCount,
  findMatchIndexesCount,
  findQuery,
  onFindQueryChange,
  onJumpMatch,
  onReplaceAll,
  onReplaceQueryChange,
  onToggleReplacePanel,
  replacePanelOpen,
  replaceQuery,
  replacingText
}: FindReplacePanelProps): ReactElement {
  return (
    <div className="find-replace-panel">
      <SearchField
        ariaLabel="Find transcript text"
        className="compact-find-field"
        iconSize={14}
        onChange={onFindQueryChange}
        placeholder="Find"
        value={findQuery}
      />
      <div className="find-nav-controls" aria-label="Find result navigation">
        <button
          aria-label="Previous match"
          disabled={findMatchIndexesCount === 0}
          onClick={() => onJumpMatch('previous')}
          type="button"
        >
          <SkipBack size={14} />
        </button>
        <button
          aria-label="Next match"
          disabled={findMatchIndexesCount === 0}
          onClick={() => onJumpMatch('next')}
          type="button"
        >
          <SkipForward size={14} />
        </button>
      </div>
      <span className="find-count">{findQuery.trim() ? `${findMatchIndexesCount === 0 ? 0 : activeFindIndex + 1}/${findMatchCount}` : 'Find text'}</span>
      <button
        aria-expanded={replacePanelOpen}
        className={`secondary-action replace-toggle ${replacePanelOpen ? 'active' : ''}`}
        onClick={onToggleReplacePanel}
        type="button"
      >
        <Pencil size={14} />
        Replace
      </button>
      {replacePanelOpen ? (
        <>
          <input
            aria-label="Replace transcript text"
            className="replace-field"
            onChange={(event) => onReplaceQueryChange(event.target.value)}
            placeholder="Replace"
            type="text"
            value={replaceQuery}
          />
          <button
            className="secondary-action"
            disabled={!findQuery.trim() || findMatchCount === 0 || replacingText}
            onClick={onReplaceAll}
            type="button"
          >
            Replace all
          </button>
        </>
      ) : null}
    </div>
  );
}
