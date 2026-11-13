import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../../components/Icon';
import Button from '../../components/Button';
import PageHeader from '../../components/PageHeader';
import FilterBar, { FilterField } from '../../components/FilterBar';
import EmptyState from '../../components/EmptyState';
import { CardSkeleton } from '../../components/LoadingState';
import ExternalJobCard from '../../components/ExternalJobCard';
import { searchExternalJobs, getExternalJobCategories } from '../../services/externalJobService';

/**
 * pages/student/ExternalJobs.jsx
 * ===========================================================================
 * DISCOVER EXTERNAL OPPORTUNITIES
 * ===========================================================================
 * This page is a window onto Adzuna, a third-party job board. Every vacancy on
 * it is real, live data fetched through our own backend - nothing is stored in
 * MongoDB and nothing is invented.
 *
 * Three states it must always be honest about:
 *   - the server has no Adzuna credentials  -> "not configured" panel
 *   - the provider is down / rate limiting  -> error panel with Retry
 *   - the search matched nothing            -> empty state
 *
 * The page never blocks the rest of the student portal: it is its own route
 * with its own request lifecycle.
 */

const RESULTS_PER_PAGE = 20;

const EMPTY_FILTERS = { what: '', where: '', category: '' };

export default function ExternalJobs() {
  // What the student is typing (not yet sent).
  const [draft, setDraft] = useState(EMPTY_FILTERS);
  // What was actually sent to the API.
  const [applied, setApplied] = useState(EMPTY_FILTERS);
  const [sortBy, setSortBy] = useState('relevance');

  const [jobs, setJobs] = useState([]);
  const [meta, setMeta] = useState(null); // { total, hasMore, source, fetchedAt }
  const [page, setPage] = useState(1);

  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null); // { message, code, missing }
  const [categories, setCategories] = useState([]);

  // Only the response of the newest request may touch state, so a fast second
  // search cannot be overwritten by a slow first one.
  const requestRef = useRef(0);

  const load = useCallback(
    async (query, nextPage, append) => {
      const requestId = requestRef.current + 1;
      requestRef.current = requestId;

      if (append) setLoadingMore(true);
      else {
        setLoading(true);
        setJobs([]);
      }
      setError(null);

      try {
        const result = await searchExternalJobs({
          ...query,
          sortBy,
          page: nextPage,
          resultsPerPage: RESULTS_PER_PAGE,
        });
        if (requestId !== requestRef.current) return;

        setJobs((previous) => (append ? [...previous, ...result.jobs] : result.jobs));
        setMeta(result);
        setPage(nextPage);
      } catch (caught) {
        if (requestId !== requestRef.current) return;
        setError({
          message: caught.message,
          code: caught.details?.code || (caught.status === 0 ? 'offline' : 'unknown'),
          missing: caught.details?.missing || [],
          status: caught.status,
        });
        if (!append) setJobs([]);
      } finally {
        if (requestId === requestRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [sortBy],
  );

  // First load + every time the applied query changes.
  useEffect(() => {
    load(applied, 1, false);
  }, [applied, load]);

  // The category list comes from Adzuna itself; if it fails we simply show no
  // category options rather than inventing one.
  useEffect(() => {
    let cancelled = false;
    getExternalJobCategories()
      .then((result) => {
        if (!cancelled) setCategories(result.categories || []);
      })
      .catch(() => {
        if (!cancelled) setCategories([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const submitSearch = (event) => {
    event?.preventDefault();
    setApplied({ ...draft });
  };

  const changeCategory = (value) => {
    setDraft((previous) => ({ ...previous, category: value }));
    setApplied((previous) => ({ ...previous, category: value }));
  };

  const resetSearch = () => {
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
  };

  const activeFilterCount =
    (draft.what ? 1 : 0) + (draft.where ? 1 : 0) + (draft.category ? 1 : 0);

  const notConfigured = error?.code === 'not_configured';

  return (
    <>
      <PageHeader
        title="Discover External Opportunities"
        subtitle="Live vacancies from employers who are not visiting your campus. These listings come from Adzuna - they are not campus drives and you apply on the employer's own site."
      >
        <span className="badge badge--neutral">
          <Icon name="layers" size={13} /> External job board
        </span>
      </PageHeader>

      {notConfigured ? (
        <section className="card card--pad">
          <div className="inline-note inline-note--warning">
            <Icon name="alert-triangle" size={16} />
            <div>
              <strong>External job search is not configured yet.</strong>
              <p className="text-sm" style={{ margin: '6px 0 0' }}>
                The server needs an Adzuna API key before it can show real vacancies. Add
                {' '}<code>ADZUNA_APP_ID</code> and <code>ADZUNA_APP_KEY</code> to the
                {' '}<code>.env</code> file in the project root and restart the API.
                {error.missing?.length ? (
                  <> Missing right now: <strong>{error.missing.join(', ')}</strong>.</>
                ) : null}
              </p>
              <p className="text-sm muted" style={{ margin: '6px 0 0' }}>
                Free keys: <a href="https://developer.adzuna.com/signup" target="_blank" rel="noopener noreferrer">developer.adzuna.com/signup</a>.
                Campus drives and applications are unaffected - they keep working normally.
              </p>
            </div>
          </div>
        </section>
      ) : (
        <>
          {/* ------------------------------ filters ------------------------------ */}
          <form onSubmit={submitSearch}>
            <FilterBar activeCount={activeFilterCount} onClear={resetSearch}>
              <FilterField label="Search jobs">
                <div className="search-bar">
                  <Icon name="search" size={16} />
                  <input
                    type="text"
                    value={draft.what}
                    placeholder="Software engineer, data analyst..."
                    onChange={(event) => setDraft({ ...draft, what: event.target.value })}
                    aria-label="Search external jobs"
                  />
                  {draft.what ? (
                    <button
                      type="button"
                      className="search-bar__clear"
                      aria-label="Clear search"
                      onClick={() => setDraft({ ...draft, what: '' })}
                    >
                      <Icon name="x" size={15} />
                    </button>
                  ) : null}
                </div>
              </FilterField>

              <FilterField label="Location">
                <div className="search-bar">
                  <Icon name="map-pin" size={16} />
                  <input
                    type="text"
                    value={draft.where}
                    placeholder="Pune, Bengaluru, Mumbai..."
                    onChange={(event) => setDraft({ ...draft, where: event.target.value })}
                    aria-label="Location"
                  />
                </div>
              </FilterField>

              <FilterField label="Category">
                <select className="select" value={draft.category} onChange={(event) => changeCategory(event.target.value)}>
                  <option value="">All categories</option>
                  {categories.map((category) => (
                    <option key={category.tag} value={category.tag}>
                      {category.label}
                    </option>
                  ))}
                </select>
              </FilterField>

              <FilterField label="Sort by">
                <select
                  className="select"
                  value={sortBy}
                  onChange={(event) => {
                    setSortBy(event.target.value);
                    setApplied({ ...draft });
                  }}
                >
                  <option value="relevance">Best match</option>
                  <option value="date">Newest first</option>
                  <option value="salary">Highest salary</option>
                </select>
              </FilterField>

              <FilterField label="">
                <Button type="submit" icon="search" loading={loading}>
                  Search
                </Button>
              </FilterField>
            </FilterBar>
          </form>

          {/* ------------------------------ results ------------------------------ */}
          {loading ? <CardSkeleton count={4} /> : null}

          {!loading && error ? (
            <section className="card card--pad">
              <div className="inline-note inline-note--warning">
                <Icon name={error.status === 0 ? 'alert-circle' : 'alert-triangle'} size={16} />
                <div>
                  <strong>
                    {error.status === 0
                      ? 'Cannot reach the Job N Job server'
                      : error.code === 'provider_rate_limited'
                        ? 'Search limit reached for now'
                        : 'External jobs are unavailable right now'}
                  </strong>
                  <p className="text-sm" style={{ margin: '6px 0 0' }}>{error.message}</p>
                  <div className="row gap-8 mt-12 wrap">
                    <Button variant="outline" size="sm" icon="refresh" onClick={() => load(applied, 1, false)}>
                      Try again
                    </Button>
                  </div>
                </div>
              </div>
            </section>
          ) : null}

          {!loading && !error ? (
            <>
              <div className="filter-summary">
                <Icon name="layers" size={15} />
                <span>
                  Showing <strong>{jobs.length}</strong>
                  {meta?.total ? <> of {meta.total.toLocaleString('en-IN')}</> : null} live vacancies
                  {applied.what ? <> for "{applied.what}"</> : null}
                  {applied.where ? <> in {applied.where}</> : null}
                </span>
                {meta?.source?.name ? <span className="badge badge--info">source: {meta.source.name}</span> : null}
              </div>

              {jobs.length === 0 ? (
                <EmptyState
                  icon="search"
                  title="No vacancies match this search"
                  text="Try a broader keyword (for example just 'developer'), a different city, or clear the filters."
                >
                  <Button variant="outline" icon="refresh" onClick={resetSearch}>
                    Clear filters
                  </Button>
                </EmptyState>
              ) : (
                <>
                  <div className="grid grid-2">
                    {jobs.map((job) => (
                      <ExternalJobCard key={job.id} job={job} />
                    ))}
                  </div>

                  <div className="external-jobs__footer">
                    <div className="text-xs muted">
                      {meta?.source?.attribution ? (
                        <>
                          {meta.source.attribution} &middot; listings are published by the employer and are not
                          verified by the placement cell.
                        </>
                      ) : (
                        'Listings are published by the employer and are not verified by the placement cell.'
                      )}
                    </div>

                    {meta?.hasMore ? (
                      <Button
                        variant="outline"
                        icon="chevron-down"
                        loading={loadingMore}
                        onClick={() => load(applied, page + 1, true)}
                      >
                        Load more vacancies
                      </Button>
                    ) : (
                      <span className="text-xs muted">End of results</span>
                    )}
                  </div>
                </>
              )}
            </>
          ) : null}
        </>
      )}

      {meta?.source?.url ? (
        <p className="text-xs muted mt-16">
          Job search powered by{' '}
          <a href={meta.source.url} target="_blank" rel="noopener noreferrer">
            Adzuna
          </a>
          . {meta.fetchedAt ? `Fetched ${new Date(meta.fetchedAt).toLocaleTimeString()}.` : null}
        </p>
      ) : null}
    </>
  );
}
