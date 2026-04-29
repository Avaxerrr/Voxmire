import { AlertTriangle, Cpu, FileText, FolderOpen, Keyboard, Lock, MicVocal, SlidersHorizontal } from 'lucide-react';
import type { ReactElement } from 'react';
import type {
  EngineAvailability,
  MachineProfile,
  ModelProfile,
  ResourceStatus,
  TranscriptionPresetId
} from '@voxmire/contracts';
import { formatBytes } from '../lib/format';
import { backendOptions, modelInstalled, modelLabel, modelResource, presetModelOptionLabel, visiblePresetOptions, type BackendPreference, type ResolvedTranscriptionPreset } from '../lib/presets';

type AppInfo = {
  name: string;
  version: string;
  platform: string;
  arch: string;
};

type SettingsViewProps = {
  appInfo: AppInfo | null;
  engines: EngineAvailability[];
  exportDirectory: string | null;
  machineProfile: MachineProfile | null;
  models: ModelProfile[];
  onChooseExportDirectory: () => void;
  onResetExportDirectory: () => void;
  resources: ResourceStatus[];
  selectedBackendPreference: BackendPreference;
  selectedPresetId: TranscriptionPresetId;
  selectedPresetResolution: ResolvedTranscriptionPreset;
  setSelectedBackendPreference: (preference: BackendPreference) => void;
  setSelectedPresetId: (presetId: TranscriptionPresetId) => void;
};

const transcriptShortcuts = [
  { keys: 'Enter', action: 'Split segment at the cursor' },
  { keys: 'Shift+Enter', action: 'Insert a line break inside the segment' },
  { keys: 'Backspace', action: 'At segment start, merge with previous' },
  { keys: 'Delete', action: 'At segment end, merge with next' },
  { keys: 'Tab', action: 'Save and move to next segment' },
  { keys: 'Shift+Tab', action: 'Save and move to previous segment' },
  { keys: 'Esc', action: 'Cancel the active edit' },
  { keys: 'Space', action: 'Play or pause media' },
  { keys: 'Ctrl/Cmd+S', action: 'Save the active segment' }
];

export function SettingsView({ appInfo, engines, exportDirectory, machineProfile, models, onChooseExportDirectory, onResetExportDirectory, resources, selectedBackendPreference, selectedPresetId, selectedPresetResolution, setSelectedBackendPreference, setSelectedPresetId }: SettingsViewProps): ReactElement {
  const readyResources = resources.filter((resource) => resource.available).length;
  const selectablePresets = visiblePresetOptions(resources);
  const installedModels = models.filter((model) => modelInstalled(resources, model.id));

  return (
    <div className="view workspace-page settings-view">
      <header className="page-header settings-header">
        <p className="eyebrow">Preferences</p>
        <h2>Settings</h2>
      </header>

      <div className="settings-stack">
        <section className="settings-panel panel-glow">
          <div className="settings-panel-heading">
            <SlidersHorizontal size={18} />
            <div>
              <h3>Transcription defaults</h3>
              <p>Choose the default local model used for new imports.</p>
            </div>
          </div>
          <div className="settings-field-grid">
            <label>
              <span className="field-label">Default model</span>
              <select value={selectedPresetId} onChange={(event) => setSelectedPresetId(event.target.value as TranscriptionPresetId)}>
                {selectablePresets.map((preset) => <option key={preset.id} value={preset.id}>{presetModelOptionLabel(models, preset)}</option>)}
              </select>
            </label>
            <label>
              <span className="field-label">Backend</span>
              <select value={selectedBackendPreference} onChange={(event) => setSelectedBackendPreference(event.target.value as BackendPreference)}>
                <option value="auto">Auto ({selectedPresetResolution.engineBackend.toUpperCase()})</option>
                {backendOptions(machineProfile).map((backend) => (
                  <option disabled={!backend.available} key={backend.backend} value={backend.backend}>
                    {backend.label}{backend.available ? '' : ' unavailable'}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <section className="settings-panel panel-glow">
          <div className="settings-panel-heading">
            <FileText size={18} />
            <div>
              <h3>Model manager</h3>
              <p>Installed local models available for new transcription jobs.</p>
            </div>
          </div>
          <div className="model-manager-list">
            {installedModels.length === 0 ? (
              <div className="model-row missing">
                <span>
                  <strong>No installed models found</strong>
                  <small>Add a local ggml model file under resources/models.</small>
                </span>
                <em>Missing</em>
              </div>
            ) : installedModels.map((model) => {
              const resource = modelResource(resources, model.id);

              return (
                <div className="model-row installed" key={model.id}>
                  <span>
                    <strong>{model.label}</strong>
                    <small>{model.purpose} / {model.relativeSpeed} / {model.relativeQuality}</small>
                  </span>
                  <em>Installed</em>
                  <p>{resource?.path ?? 'Model path unavailable.'}</p>
                </div>
              );
            })}
          </div>
        </section>

        <section className="settings-panel panel-glow">
          <div className="settings-panel-heading">
            <Keyboard size={18} />
            <div>
              <h3>Transcript shortcuts</h3>
              <p>Keyboard controls available while editing transcript text.</p>
            </div>
          </div>
          <div className="shortcut-grid">
            {transcriptShortcuts.map((shortcut) => (
              <div className="shortcut-row" key={shortcut.keys}>
                <kbd>{shortcut.keys}</kbd>
                <span>{shortcut.action}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="settings-panel panel-glow">
          <div className="settings-panel-heading">
            <FolderOpen size={18} />
            <div>
              <h3>Export folder</h3>
              <p>Choose the folder used as the starting location for export Save dialogs.</p>
            </div>
          </div>
          <div className="export-folder-setting">
            <p>{exportDirectory ?? 'Default export folder unavailable.'}</p>
            <div>
              <button className="secondary-action" onClick={onChooseExportDirectory} type="button">Change folder</button>
              <button className="secondary-action" onClick={onResetExportDirectory} type="button">Reset</button>
            </div>
          </div>
        </section>

        <section className="settings-panel panel-glow">
          <div className="settings-panel-heading">
            <Cpu size={18} />
            <div>
              <h3>Machine profile</h3>
              <p>{machineProfile ? `${machineProfile.platform} ${machineProfile.arch} / ${machineProfile.logicalCpuCores} CPU threads / ${formatBytes(machineProfile.totalMemoryBytes)} RAM` : 'Detecting local hardware profile.'}</p>
            </div>
          </div>
          {machineProfile ? (
            <div className="machine-profile-grid">
              <div className="machine-recommendation">
                <span>Recommended</span>
                <strong>{machineProfile.recommendedBackend.toUpperCase()} / {modelLabel(models, machineProfile.recommendedModelId)}</strong>
              </div>
              <div className="backend-list">
                {machineProfile.backends.map((backend) => (
                  <div className={`backend-row ${backend.recommended ? 'recommended' : ''}`} key={backend.backend}>
                    <strong>{backend.label}</strong>
                    <span>{backend.executableAvailable && backend.runtimeAvailable ? 'Ready' : backend.executableAvailable ? 'Runtime missing' : 'Binary missing'}</span>
                    <p>{backend.reason ?? 'Available for local transcription.'}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        <section className="settings-panel panel-glow">
          <div className="settings-panel-heading">
            <MicVocal size={18} />
            <div>
              <h3>Voice Generation</h3>
              <p>Controls will become available when the local voice engine is added.</p>
            </div>
          </div>
          <span className="soon-pill inline"><Lock size={13} /> Coming soon</span>
        </section>

        <section className="settings-panel panel-glow">
          <div className="settings-panel-heading">
            <FolderOpen size={18} />
            <div>
              <h3>Application</h3>
              <p>{appInfo ? `${appInfo.name} ${appInfo.version} / ${appInfo.platform} ${appInfo.arch}` : 'Desktop runtime will appear here.'}</p>
            </div>
          </div>
        </section>

        <details className="advanced-panel panel-glow">
          <summary>
            <span><AlertTriangle size={17} /> Advanced diagnostics</span>
            <small>{readyResources}/{resources.length} resources ready</small>
          </summary>
          <div className="diagnostic-grid">
            <section>
              <h4>Engines</h4>
              {engines.map((engine) => (
                <DiagnosticRow key={engine.id} label={engine.label} status={engine.available ? 'Ready' : 'Missing'} detail={engine.available ? engine.executablePath : engine.reason} />
              ))}
            </section>
            <section>
              <h4>Resources</h4>
              {resources.map((resource) => (
                <DiagnosticRow key={resource.id} label={resource.label} status={resource.available ? 'Ready' : resource.required ? 'Required' : 'Optional'} detail={resource.available ? resource.path : resource.reason} />
              ))}
            </section>
          </div>
        </details>
      </div>
    </div>
  );
}

function DiagnosticRow({ detail, label, status }: { detail: string | null; label: string; status: string }): ReactElement {
  return (
    <div className="diagnostic-row">
      <strong>{label}</strong>
      <span>{status}</span>
      <p>{detail ?? 'No details available.'}</p>
    </div>
  );
}
