import { type MutableRefObject, type ReactElement } from 'react';
import { ChevronDown, Download, Plus, Redo2, RotateCcw, Search, Undo2 } from 'lucide-react';
import type { ExportFormat, ExportTextMode, JobWithSource } from '@voxmire/contracts';
import { ProjectActionsMenu } from '../../components/project-actions-menu';

type ExportOption = {
  format: ExportFormat;
  label: string;
  textMode?: ExportTextMode;
};

const exportOptions: ExportOption[] = [
  { format: 'txt', label: 'Text only', textMode: 'plain' },
  { format: 'txt', label: 'Text with timestamps', textMode: 'timestamps' },
  { format: 'srt', label: 'SubRip captions' },
  { format: 'vtt', label: 'WebVTT captions' },
  { format: 'json', label: 'JSON data' }
];

type TranscriptHeaderProps = {
  busy: boolean;
  exportMenuOpen: boolean;
  exportMenuRef: MutableRefObject<HTMLDivElement | null>;
  findPanelOpen: boolean;
  hasSegments: boolean;
  historyBusy: boolean;
  jobCount: number;
  onDeleteProject: () => void;
  onDetailsProject: () => void;
  onImport: () => void;
  onRedo: () => void;
  onRenameProject: () => void;
  onResetTranscript: () => void;
  onSelectExportOption: (format: ExportFormat, textMode: ExportTextMode) => void;
  onToggleExportMenu: () => void;
  onToggleFindPanel: () => void;
  onToggleSwitcher: () => void;
  onUndo: () => void;
  redoLabel: string | null;
  resettingTranscript: boolean;
  selectedJob: JobWithSource | null;
  selectedSubtitle: string;
  switcherOpen: boolean;
  undoLabel: string | null;
};

export function TranscriptHeader({
  busy,
  exportMenuOpen,
  exportMenuRef,
  findPanelOpen,
  hasSegments,
  historyBusy,
  jobCount,
  onDeleteProject,
  onDetailsProject,
  onImport,
  onRedo,
  onRenameProject,
  onResetTranscript,
  onSelectExportOption,
  onToggleExportMenu,
  onToggleFindPanel,
  onToggleSwitcher,
  onUndo,
  redoLabel,
  resettingTranscript,
  selectedJob,
  selectedSubtitle,
  switcherOpen,
  undoLabel
}: TranscriptHeaderProps): ReactElement {
  return (
    <header className="workspace-header transcript-topbar glass-bar">
      <div className="title-stack">
        <p className="eyebrow">Transcript</p>
        <div className="transcript-title-row">
          <h2 className="transcript-title-heading">
            <button
              aria-expanded={switcherOpen}
              aria-haspopup="dialog"
              aria-label="Switch transcript"
              className={`transcript-title-switcher ${switcherOpen ? 'active' : ''}`}
              disabled={jobCount === 0}
              onClick={onToggleSwitcher}
              title="Switch transcript"
              type="button"
            >
              <span className="transcript-title-text">{selectedJob?.sourceFile.name ?? 'No transcript selected'}</span>
              <ChevronDown size={16} />
            </button>
          </h2>
          {selectedJob ? (
            <ProjectActionsMenu
              onDelete={onDeleteProject}
              onDetails={onDetailsProject}
              onRename={onRenameProject}
            />
          ) : null}
          <div className="transcript-actions">
            <button
              aria-label="Undo transcript edit"
              className="icon-button"
              disabled={!selectedJob || historyBusy || !undoLabel}
              onClick={onUndo}
              title={undoLabel ? `Undo ${undoLabel}` : 'Undo'}
              type="button"
            >
              <Undo2 size={17} />
            </button>
            <button
              aria-label="Redo transcript edit"
              className="icon-button"
              disabled={!selectedJob || historyBusy || !redoLabel}
              onClick={onRedo}
              title={redoLabel ? `Redo ${redoLabel}` : 'Redo'}
              type="button"
            >
              <Redo2 size={17} />
            </button>
            <button
              aria-label="Reset transcript"
              className="icon-button danger-icon-button"
              disabled={!selectedJob || historyBusy || resettingTranscript || !hasSegments}
              onClick={onResetTranscript}
              title="Reset transcript"
              type="button"
            >
              <RotateCcw size={16} />
            </button>
            <button
              aria-expanded={findPanelOpen}
              aria-label="Find and replace transcript"
              className={`icon-button ${findPanelOpen ? 'active' : ''}`}
              onClick={onToggleFindPanel}
              title="Find and replace"
              type="button"
            >
              <Search size={17} />
            </button>
            <div className="export-menu" ref={exportMenuRef}>
              <button
                aria-expanded={exportMenuOpen}
                aria-label="Export transcript"
                className={`icon-button export-trigger ${exportMenuOpen ? 'active' : ''}`}
                disabled={!selectedJob || !hasSegments}
                onClick={onToggleExportMenu}
                title="Export transcript"
                type="button"
              >
                <Download size={16} />
              </button>
              {exportMenuOpen ? (
                <div className="export-menu-popover" role="menu">
                  {exportOptions.map((option) => (
                    <button
                      key={`${option.format}-${option.textMode ?? 'default'}`}
                      onClick={() => onSelectExportOption(option.format, option.textMode ?? 'plain')}
                      role="menuitem"
                      type="button"
                    >
                      <Download size={14} />
                      <span>{option.label}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <button aria-label="Import transcript" className="primary-action icon-action" disabled={busy} onClick={onImport} title="Import transcript" type="button">
              <Plus size={17} />
            </button>
          </div>
        </div>
        <span>{selectedSubtitle}</span>
      </div>
    </header>
  );
}
