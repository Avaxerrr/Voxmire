import { type ChangeEvent, type ReactElement } from 'react';
import { Search } from 'lucide-react';

type SearchFieldProps = {
  ariaLabel: string;
  className?: string;
  iconSize?: number;
  name?: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
};

export function SearchField({
  ariaLabel,
  className,
  iconSize = 15,
  name,
  onChange,
  placeholder,
  value
}: SearchFieldProps): ReactElement {
  const fieldClassName = className ? `search-field ${className}` : 'search-field';

  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    onChange(event.target.value);
  }

  return (
    <label className={fieldClassName}>
      <Search size={iconSize} />
      <input
        aria-label={ariaLabel}
        name={name}
        onChange={handleChange}
        placeholder={placeholder}
        spellCheck={false}
        type="search"
        value={value}
      />
    </label>
  );
}