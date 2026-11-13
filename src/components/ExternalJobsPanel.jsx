import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from './Icon';
import Button from './Button';
import EmptyState from './EmptyState';
import ExternalJobCard from './ExternalJobCard';
import { searchExternalJobs } from '../services/externalJobService';

/**
 * components/ExternalJobsPanel.jsx
 * ---------------------------------------------------------------------------
 * The compact "Discover External Opportunities" block on the student
 * dashboard: a small search form plus the first few live vacancies, with a
 * link to the full page.
 *
 * IMPORTANT: this panel is deliberately self-contained and fail-soft. If the
 * Adzuna credentials are missing, the provider is down or the network drops,
 * it renders a one-line message and the rest of the dashboard keeps working
 * exactly as before. It never throws upward and never blocks `Promise.all`
 * anywhere in DataContext.
 */

const PREVIEW_COUNT = 4;

export default function ExternalJobsPanel() {
  const navigate = useNavigate();

  const [form, setForm] = useState({ what: '', where: '' });
  const [query, setQuery] = useState({ what: '', where: '' });
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const requestRef = useRef(0);

  const load = useCallback(async (nextQuery) => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;

    setLoading(true);
    setError(null);

    try {
      const result = await searchExternalJobs({
        ...nextQuery,
        page: 1,
        resultsPerPage: PREVIEW_COUNT,
      });
      if (requestId !== requestRef.current) return;
      setJobs(result.jobs);
    } catch (caught) {
      if (requestId !== requestRef.current) return;
      setJobs([]);
      setError({
        message: caught.message,
        code: caught.details?.code || 'unknown',
      });
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(query);
  }, [load, query]);

  const submit = (event) => {
    event.preventDefault();
    setQuery({ ...form });
  };

  return (
    <section className="section">
      <div className="section__head">
        <div>
          <h2 className="section__title">Discover External Opportunities</h2>
          <p className="section__hint">
            Live vacancies from employers who are not visiting your campus, sourced from Adzuna.
          </p>
        </div>
        <Button variant="ghost" size="sm" iconRight="chevron-right" onClick={() => navigate('/student/external-jobs')}>
          View all
        </Button>
      </div>

      <form className="external-panel__search" onSubmit={submit}>
        <div className="search-bar">
          <Icon name="search" size={16} />
          <input
            type="text"
            value={form.what}
            placeholder="Search external jobs - role, skill or company"
            aria-label="Search external jobs"
            onChange={(event) => setForm({ ...form, what: event.target.value })}
          />
        </div>

        <div className="search-bar">
          <Icon name="map-pin" size={16} />
          <input
            type="text"
            value={form.where}
            placeholder="City (optional)"
            aria-label="City"
            onChange={(event) => setForm({ ...form, where: event.target.value })}
          />
        </div>

        <Button type="submit" icon="search" loading={loading}>
          Search
        </Button>
      </form>

      {loading ? (
        <div className="grid grid-2">
          {Array.from({ length: 2 }).map((_, index) => (
            <div className="card card--pad" key={index}>
              <div className="skeleton skeleton--line" style={{ width: '45%' }} />
              <div className="skeleton skeleton--line" style={{ width: '75%' }} />
              <div className="skeleton skeleton--card" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="inline-note inline-note--warning">
          <Icon name="alert-triangle" size={16} />
          <div>
            {error.code === 'not_configured' ? (
              <>
                <strong>External job search is not configured.</strong> Add <code>ADZUNA_APP_ID</code> and{' '}
                <code>ADZUNA_APP_KEY</code> to the server <code>.env</code> file to show real vacancies here.
              </>
            ) : (
              <>
                <strong>External jobs are unavailable right now.</strong> {error.message} Campus drives and
                applications below are unaffected.
              </>
            )}
          </div>
        </div>
      ) : jobs.length === 0 ? (
        <EmptyState
          icon="search"
          title="No external vacancies matched that search"
          text="Try a broader keyword such as 'developer' or open the full page to filter by category and location."
        >
          <Button variant="outline" icon="layers" onClick={() => navigate('/student/external-jobs')}>
            Open external job search
          </Button>
        </EmptyState>
      ) : (
        <div className="grid grid-2">
          {jobs.map((job) => (
            <ExternalJobCard key={job.id} job={job} />
          ))}
        </div>
      )}
    </section>
  );
}
