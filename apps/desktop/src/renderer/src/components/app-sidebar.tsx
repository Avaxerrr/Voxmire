import { type ReactElement } from 'react';
import { AudioWaveform, FileText, Home, MicVocal, PanelLeftClose, PanelLeftOpen, Settings } from 'lucide-react';
import { NavButton } from './nav-button';

export type AppSidebarView = 'dashboard' | 'transcript' | 'voice' | 'settings';

type AppSidebarProps = {
  activeView: AppSidebarView;
  collapsed: boolean;
  onSelectView: (view: AppSidebarView) => void;
  onToggleCollapsed: () => void;
};

export function AppSidebar({ activeView, collapsed, onSelectView, onToggleCollapsed }: AppSidebarProps): ReactElement {
  return (
    <aside className="sidebar" aria-label="Workspace navigation">
      <div className="brand-block">
        <div className="brand-mark"><AudioWaveform size={18} /></div>
        <div className="brand-copy">
          <h1>VOXMIRE</h1>
          <p>Local transcription studio</p>
        </div>
        <button className="collapse-button" onClick={onToggleCollapsed} type="button" title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
        </button>
      </div>

      <nav className="nav-list" aria-label="Primary">
        <NavButton active={activeView === 'dashboard'} collapsed={collapsed} icon={<Home size={18} />} label="Library" onClick={() => onSelectView('dashboard')} />
        <NavButton active={activeView === 'transcript'} collapsed={collapsed} icon={<FileText size={18} />} label="Transcript" onClick={() => onSelectView('transcript')} />
        <NavButton active={activeView === 'voice'} collapsed={collapsed} icon={<MicVocal size={18} />} label="Voice Studio" onClick={() => onSelectView('voice')} badge="Soon" />
        <NavButton active={activeView === 'settings'} collapsed={collapsed} icon={<Settings size={18} />} label="Settings" onClick={() => onSelectView('settings')} />
      </nav>
    </aside>
  );
}
