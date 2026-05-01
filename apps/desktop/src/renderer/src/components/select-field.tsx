import { type KeyboardEvent, type ReactElement, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export type SelectOption<T extends string | number> = {
  disabled?: boolean;
  label: string;
  value: T;
};

type SelectFieldProps<T extends string | number> = {
  className?: string;
  disabled?: boolean;
  label: string;
  onChange: (value: T) => void;
  options: readonly SelectOption<T>[];
  value: T;
};

export function SelectField<T extends string | number>({ className, disabled = false, label, onChange, options, value }: SelectFieldProps<T>): ReactElement {
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const baseId = useId();
  const labelId = `${baseId}-label`;
  const listboxId = `${baseId}-listbox`;
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : null;
  const enabledIndexes = useMemo(() => options.map((option, index) => (option.disabled ? -1 : index)).filter((index) => index >= 0), [options]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const initialIndex = selectedIndex >= 0 && !options[selectedIndex]?.disabled ? selectedIndex : enabledIndexes[0] ?? 0;
    setHighlightedIndex(initialIndex);
  }, [enabledIndexes, open, options, selectedIndex]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent): void {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  function optionId(index: number): string {
    return `${baseId}-option-${index}`;
  }

  function moveHighlight(direction: 1 | -1): void {
    if (enabledIndexes.length === 0) {
      return;
    }

    const currentEnabledIndex = enabledIndexes.indexOf(highlightedIndex);
    const nextEnabledIndex = currentEnabledIndex === -1
      ? 0
      : (currentEnabledIndex + direction + enabledIndexes.length) % enabledIndexes.length;
    setHighlightedIndex(enabledIndexes[nextEnabledIndex] ?? enabledIndexes[0] ?? highlightedIndex);
  }

  function chooseOption(option: SelectOption<T>): void {
    if (disabled || option.disabled) {
      return;
    }

    onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (disabled) {
      return;
    }

    if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      setOpen(true);
      return;
    }

    if (!open) {
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveHighlight(1);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveHighlight(-1);
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      setHighlightedIndex(enabledIndexes[0] ?? highlightedIndex);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      setHighlightedIndex(enabledIndexes[enabledIndexes.length - 1] ?? highlightedIndex);
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const highlightedOption = options[highlightedIndex];
      if (highlightedOption) {
        chooseOption(highlightedOption);
      }
    }
  }

  return (
    <div
      className={`select-field${open ? ' open' : ''}${disabled ? ' disabled' : ''}${className ? ` ${className}` : ''}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOpen(false);
        }
      }}
      ref={rootRef}
    >
      <span className="field-label" id={labelId}>{label}</span>
      <button
        aria-activedescendant={open && options[highlightedIndex] ? optionId(highlightedIndex) : undefined}
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-labelledby={`${labelId} ${baseId}-value`}
        className="select-trigger"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleKeyDown}
        ref={triggerRef}
        title={selectedOption?.label ?? label}
        type="button"
      >
        <span className="select-value" id={`${baseId}-value`}>{selectedOption?.label ?? 'Select'}</span>
        <ChevronDown aria-hidden="true" className="select-chevron" size={16} />
      </button>

      {open ? (
        <div aria-labelledby={labelId} className="select-popover" id={listboxId} role="listbox">
          {options.map((option, index) => {
            const selected = option.value === value;
            const highlighted = index === highlightedIndex;

            return (
              <button
                aria-selected={selected}
                className={`select-option${selected ? ' selected' : ''}${highlighted ? ' highlighted' : ''}`}
                disabled={option.disabled}
                id={optionId(index)}
                key={`${String(option.value)}-${index}`}
                onClick={() => chooseOption(option)}
                onMouseEnter={() => !option.disabled && setHighlightedIndex(index)}
                role="option"
                type="button"
              >
                <span>{option.label}</span>
                {selected ? <Check aria-hidden="true" size={14} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}