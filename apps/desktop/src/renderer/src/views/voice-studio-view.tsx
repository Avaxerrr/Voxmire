import { Lock, MicVocal, Play, Sparkles } from 'lucide-react';
import type { ReactElement } from 'react';

export function VoiceStudioView(): ReactElement {
  return (
    <div className="view workspace-page voice-view">
      <header className="workspace-header voice-header glass-bar">
        <div>
          <p className="eyebrow">Voice Studio</p>
          <h2>Voice Generation</h2>
          <span>UI preview only. Generation is not connected yet.</span>
        </div>
        <span className="soon-pill"><Lock size={13} /> Coming soon</span>
      </header>

      <div className="voice-layout">
        <section className="script-panel panel-glow">
          <textarea disabled placeholder="Type or paste your script here..." />
          <div className="script-footer">
            <span>0 / 5000 characters</span>
            <button className="primary-action" disabled type="button"><Sparkles size={16} /> Generate Speech</button>
          </div>
        </section>

        <aside className="voice-inspector panel-glow">
          <section>
            <p className="eyebrow">Selected voice</p>
            <button className="voice-card selected" disabled type="button">
              <span className="voice-avatar"><MicVocal size={18} /></span>
              <span>
                <strong>Narrator</strong>
                <small>Clean / Professional</small>
              </span>
              <Play size={18} />
            </button>
            <button className="ghost-button" disabled type="button">Browse Voice Library</button>
          </section>

          <section>
            <p className="eyebrow">Voice tuning</p>
            <TuningSlider label="Stability" value="75" />
            <TuningSlider label="Clarity" value="82" />
          </section>
        </aside>
      </div>
    </div>
  );
}

function TuningSlider({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <label className="tuning-slider">
      <span><strong>{label}</strong><em>{Number(value) / 100}</em></span>
      <input disabled max="100" min="0" type="range" value={value} readOnly />
    </label>
  );
}
