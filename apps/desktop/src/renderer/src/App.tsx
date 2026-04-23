import { type ReactElement, useEffect, useState } from 'react';

type AppInfo = {
  name: string;
  version: string;
  platform: string;
  arch: string;
};

const modelProfiles = [
  { name: 'large-v3-turbo', purpose: 'Default', detail: 'Balanced quality and speed for most machines.' },
  { name: 'large-v3', purpose: 'Quality', detail: 'Best quality mode when time and memory allow.' },
  { name: 'distil-large-v3.5', purpose: 'Fast English', detail: 'Fast option for English-heavy work.' },
  { name: 'medium', purpose: 'Fallback', detail: 'Lower memory option for older hardware.' }
];

const pipelineSteps = [
  'Import source file',
  'Probe with ffmpeg',
  'Prepare audio chunks',
  'Transcribe with whisper.cpp',
  'Save transcript segments',
  'Export when ready'
];

export function App(): ReactElement {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    void window.voxmire.app.getInfo().then(setAppInfo);
  }, []);

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Workspace navigation">
        <div className="brand-block">
          <div className="brand-mark">V</div>
          <div>
            <h1>Voxmire</h1>
            <p>Local transcription</p>
          </div>
        </div>

        <nav className="nav-list" aria-label="Primary">
          <button className="nav-item active" type="button">Jobs</button>
          <button className="nav-item" type="button">Models</button>
          <button className="nav-item" type="button">Exports</button>
          <button className="nav-item" type="button">Settings</button>
        </nav>

        <div className="runtime-card">
          <span>Runtime</span>
          <strong>{appInfo ? `${appInfo.platform} ${appInfo.arch}` : 'Detecting...'}</strong>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Desktop MVP</p>
            <h2>Transcription Queue</h2>
          </div>
          <button className="primary-action" type="button">Import audio</button>
        </header>

        <section className="hero-panel" aria-label="Import audio">
          <div>
            <h3>Drop a long recording to start</h3>
            <p>
              Voxmire will prepare the audio locally, run a selected Whisper model, and keep progress durable for long sessions.
            </p>
          </div>
          <button className="secondary-action" type="button">Choose file</button>
        </section>

        <section className="content-grid">
          <article className="panel">
            <div className="panel-header">
              <h3>Pipeline</h3>
              <span>Planned V1 flow</span>
            </div>
            <ol className="step-list">
              {pipelineSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </article>

          <article className="panel">
            <div className="panel-header">
              <h3>Model Profiles</h3>
              <span>Initial shortlist</span>
            </div>
            <div className="model-list">
              {modelProfiles.map((model) => (
                <div className="model-row" key={model.name}>
                  <div>
                    <strong>{model.name}</strong>
                    <p>{model.detail}</p>
                  </div>
                  <span>{model.purpose}</span>
                </div>
              ))}
            </div>
          </article>
        </section>
      </section>
    </main>
  );
}
