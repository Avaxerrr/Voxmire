import { FileText } from 'lucide-react';
import type { ReactElement } from 'react';

export function EmptyState({ body, title }: { body: string; title: string }): ReactElement {
  return (
    <div className="empty-state">
      <FileText size={20} />
      <h4>{title}</h4>
      <p>{body}</p>
    </div>
  );
}
