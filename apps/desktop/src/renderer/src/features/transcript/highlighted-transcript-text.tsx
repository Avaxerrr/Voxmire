import { type ReactElement } from 'react';
import { buildHighlightedTextSlices } from '../../lib/transcript-search';

export function HighlightedTranscriptText({ query, text }: { query: string; text: string }): ReactElement {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return <>{text}</>;
  }

  const slices = buildHighlightedTextSlices(text, normalizedQuery);

  return (
    <>
      {slices.map((slice) => {
        if (!slice.search) {
          return slice.text;
        }

        return (
          <mark
            className="segment-text-highlight segment-search-hit"
            key={`${slice.start}-${slice.end}`}
          >
            {slice.text}
          </mark>
        );
      })}
    </>
  );
}
