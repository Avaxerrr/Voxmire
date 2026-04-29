import { Maximize2, Minimize2, Minus, X } from 'lucide-react';
import { type ReactElement, useEffect, useState } from 'react';

export function WindowFrameControls(): ReactElement {
  const [isMaximized, setIsMaximized] = useState(false);
  const windowApi = window.voxmire?.window;

  useEffect(() => {
    if (!windowApi) {
      return;
    }

    void windowApi.isMaximized().then(setIsMaximized);
  }, [windowApi]);

  async function toggleMaximize(): Promise<void> {
    if (!windowApi) {
      return;
    }

    setIsMaximized(await windowApi.toggleMaximize());
  }

  return (
    <div className="window-frame-controls" aria-label="Window controls">
      <button disabled={!windowApi} onClick={() => void windowApi?.minimize()} title="Minimize" type="button">
        <Minus size={14} />
      </button>
      <button disabled={!windowApi} onClick={() => void toggleMaximize()} title={isMaximized ? 'Restore' : 'Maximize'} type="button">
        {isMaximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
      </button>
      <button className="close-control" disabled={!windowApi} onClick={() => void windowApi?.close()} title="Close" type="button">
        <X size={15} />
      </button>
    </div>
  );
}
