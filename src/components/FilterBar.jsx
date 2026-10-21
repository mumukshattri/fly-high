import Icon from './Icon';
import Button from './Button';

/**
 * components/FilterBar.jsx
 * ---------------------------------------------------------------------------
 * The white panel that holds the search box plus any number of dropdown
 * filters. The page owns the filter state; this component only renders it.
 *
 * <FilterBar activeCount={2} onClear={clearFilters}>
 *   <FilterField label="Branch">
 *     <select className="select" ...>...</select>
 *   </FilterField>
 * </FilterBar>
 */

export function FilterField({ label, children }) {
  return (
    <label className="col">
      <span className="filter-bar__label">{label}</span>
      {children}
    </label>
  );
}

export default function FilterBar({ children, onClear, activeCount = 0, extraActions }) {
  return (
    <section className="filter-bar">
      <div className="filter-bar__grid">{children}</div>
      {activeCount > 0 || extraActions ? (
        <div className="filter-bar__row mt-12" style={{ justifyContent: 'space-between' }}>
          <span className="text-sm muted row gap-4">
            <Icon name="filter" size={14} />
            {activeCount} filter{activeCount === 1 ? '' : 's'} applied
          </span>
          <div className="row gap-8">
            {extraActions}
            {activeCount > 0 ? (
              <Button variant="ghost" size="sm" icon="refresh" onClick={onClear}>
                Reset filters
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
