import Icon from './Icon';

/**
 * components/SearchBar.jsx
 * ---------------------------------------------------------------------------
 * A controlled text input with a magnifier icon and a clear (x) button.
 * It is "controlled" because the value lives in the parent page's useState -
 * that is how we make search work without a form submit.
 *
 * <SearchBar value={query} onChange={setQuery} placeholder="Search drives..." />
 */
export default function SearchBar({
  value,
  onChange,
  placeholder = 'Search...',
  autoFocus = false,
  className = '',
}) {
  return (
    <div className={`search-bar ${className}`}>
      <Icon name="search" size={16} />
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
        aria-label={placeholder}
      />
      {value ? (
        <button type="button" className="search-bar__clear" onClick={() => onChange('')} aria-label="Clear search">
          <Icon name="x" size={15} />
        </button>
      ) : null}
    </div>
  );
}
