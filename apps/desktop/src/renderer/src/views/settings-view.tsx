import { AlertTriangle, Cpu, Download, FileText, FolderOpen, Keyboard, Lock, MicVocal, SlidersHorizontal } from 'lucide-react';
import type { ReactElement } from 'react';
import type {
  EngineAvailability,
  EngineRuntimeId,
  MachineProfile,
  ModelProfile,
  ResourceStatus,
  RuntimeInstallStatus,
  TranscriptionPresetId
} from '@voxmire/contracts';
import { formatBytes, formatFileSize } from '../lib/format';
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
  installingRuntimeId: EngineRuntimeId | null;
  machineProfile: MachineProfile | null;
  models: ModelProfile[];
  onChooseExportDirectory: () => void;
  onInstallRuntime: (runtimeId: EngineRuntimeId) => void;
  onResetExportDirectory: () => void;
  resources: ResourceStatus[];
  runtimeInstallStatuses: RuntimeInstallStatus[];
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

export function SettingsView({ appInfo, engines, exportDirectory, installingRuntimeId, machineProfile, models, onChooseExportDirectory, onInstallRuntime, onResetExportDirectory, resources, runtimeInstallStatuses, selectedBackendPreference, selectedPresetId, selectedPresetResolution, setSelectedBackendPreference, setSelectedPresetId }: SettingsViewProps): ReactElement {
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
                {machineProfile.backends.map((backend) => {
                  const engine = backendEngine(engines, backend);
                  const version = runtimeVersionLabel(engine?.runtimeVersion);

                  return (
                    <div className={`backend-row ${backend.recommended ? 'recommended' : ''}`} key={backend.backend}>
                      <strong>{backend.label}</strong>
                      <span>{backend.executableAvailable && backend.runtimeAvailable ? 'Ready' : backend.executableAvailable ? 'Runtime missing' : 'Binary missing'}</span>
                      {version ? <small>{version}</small> : null}
                      <p>{backend.reason ?? 'Available for local transcription.'}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </section>

        <section className="settings-panel panel-glow">
          <div className="settings-panel-heading">
            <Download size={18} />
            <div>
              <h3>Runtime manager</h3>
              <p>Install approved whisper.cpp runtime packages for this machine.</p>
            </div>
          </div>
          <div className="runtime-manager-list">
            {runtimeInstallStatuses.length === 0 ? (
              <div className="runtime-row missing">
                <span>
                  <strong>No runtime manifest found</strong>
                  <small>Runtime downloads are unavailable.</small>
                </span>
                <em>Missing</em>
              </div>
            ) : runtimeInstallStatuses.map((runtime) => {
              const installing = installingRuntimeId === runtime.runtimeId;
              const disabled = runtime.installed || !runtime.downloadable || installing;

              return (
                <div className={`runtime-row ${runtime.installed ? 'installed' : runtime.downloadable ? 'available' : 'missing'}`} key={runtime.runtimeId}>
                  <span>
                    <strong>{runtime.label}</strong>
                    <small>{runtimeInstallSummary(runtime)}</small>
                  </span>
                  <em>{runtime.installed ? 'Installed' : runtime.downloadable ? 'Available' : 'Blocked'}</em>
                  <p>{runtime.reason ?? 'Ready to install.'}</p>
                  <button className="secondary-action runtime-install-action" disabled={disabled} onClick={() => onInstallRuntime(runtime.runtimeId)} type="button">
                    {installing ? 'Installing' : runtime.installed ? 'Installed' : 'Download'}
                  </button>
                </div>
              );
            })}
          </div>
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
                <DiagnosticRow
                  detail={engine.available ? engine.executablePath : engine.reason}
                  key={engine.id}
                  label={engine.label}
                  meta={runtimeVersionLabel(engine.runtimeVersion)}
                  status={engine.available ? 'Ready' : 'Missing'}
                />
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

function backendEngine(engines: readonly EngineAvailability[], backend: MachineProfile['backends'][number]): EngineAvailability | null {
  return engines.find((engine) => engine.backend === backend.backend && engine.available) ?? null;
}

function runtimeVersionLabel(runtimeVersion: EngineAvailability['runtimeVersion']): string | null {
  return runtimeVersion ? `whisper.cpp ${runtimeVersion}` : null;
}

function runtimeInstallSummary(runtime: RuntimeInstallStatus): string {
  const version = runtime.version ? `Stable ${runtime.version}` : 'No stable package';
  const installed = runtime.installedVersion ? `installed ${runtime.installedVersion}` : 'not installed';
  const size = runtime.sizeBytes === null ? 'size unavailable' : formatFileSize(runtime.sizeBytes);
  const parts = runtime.partCount > 0 ? ` / ${runtime.partCount} parts` : '';
  return `${version} / ${installed} / ${size}${parts}`;
}

function DiagnosticRow({ detail, label, meta, status }: { detail: string | null; label: string; meta?: string | null; status: string }): ReactElement {
  return (
    <div className="diagnostic-row">
      <strong>{label}</strong>
      <span>{status}</span>
      {meta ? <small>{meta}</small> : null}
      <p>{detail ?? 'No details available.'}</p>
    </div>
  );
}
