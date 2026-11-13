import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from './Icon';
import Button from './Button';
import MatchJobCard from './MatchJobCard';
import EmptyState from './EmptyState';
import Progress from './Progress';
import { getRecommendations } from '../services/studentService';

/**
 * components/RecommendedJobs.jsx
 * ---------------------------------------------------------------------------
 * The personalised part of the student dashboard.
 *
 *   1. Recommended for You  - the highest-ranked live vacancies
 *   2. Strong Matches       - the ones above the configured threshold
 *   3. Explore More Jobs    - everything else that was fetched (lower scores
 *                             are not hidden, they are simply labelled)
 *   4. Skill Gap Analysis   - skills that the relevant listings ask for and the
 *                             profile does not have yet
 *
 * The component is fail-soft, like ExternalJobsPanel: if the provider is down,
 * unconfigured or the session expired, it renders one honest message and the
 * campus drives below keep working.
 *
 * The match numbers come from the SERVER (`/api/student/recommendations`), so
 * the browser never re-implements - or contradicts - the ranking rules.
 */

function Skeleton() {
  return (
    <div className="grid grid-2">
      {[0, 1].map((index) => (
        <div className="card card--pad" key={index}>
          <div className="skeleton skeleton--line" style={{ width: '40%' }} />
          <div className="skeleton skeleton--line" style={{ width: '70%' }} />
          <div className="skeleton skeleton--card" />
        </div>
      ))}
    </div>
  );
}

function SectionHeading({ title, hint, action }) {
  return (
    <div className="section__head">
      <div>
        <h2 className="section__title">{title}</h2>
        {hint ? <p className="section__hint">{hint}</p> : null}
      </div>
      {action}
    </div>
  );
}

export default function RecommendedJobs() {
  const navigate = useNavigate();
  const [state, setState] = useState({ loading: true, error: null, data: null });

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const data = await getRecommendations();
      setState({ loading: false, error: null, data });
    } catch (error) {
      setState({ loading: false, error, data: null });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (state.loading) {
    return (
      <section className="section">
        <SectionHeading title="Recommended for You" hint="Matching your profile against live vacancies…" />
        <Skeleton />
      </section>
    );
  }

  if (state.error) {
    return (
      <section className="section">
        <SectionHeading title="Recommended for You" />
        <div className="inline-note inline-note--warning">
          <Icon name="alert-triangle" size={16} />
          <div>
            <strong>Personalised recommendations are unavailable right now.</strong>{' '}
            {state.error.message} Your campus drives and applications are unaffected.
          </div>
          <Button variant="outline" size="sm" icon="refresh" onClick={load}>
            Retry
          </Button>
        </div>
      </section>
    );
  }

  const data = state.data;

  if (!data?.configured) {
    return (
      <section className="section">
        <SectionHeading title="Recommended for You" />
        <div className="inline-note">
          <Icon name="info" size={16} />
          <div>
            <strong>Recommendations need live vacancy data.</strong> {data?.message}
          </div>
        </div>
      </section>
    );
  }

  if (data.degraded) {
    return (
      <section className="section">
        <SectionHeading title="Recommended for You" />
        <div className="inline-note inline-note--warning">
          <Icon name="alert-triangle" size={16} />
          <div>
            <strong>The job provider is not responding.</strong> {data.message}
          </div>
          <Button variant="outline" size="sm" icon="refresh" onClick={load}>
            Retry
          </Button>
        </div>
      </section>
    );
  }

  const { recommended = [], strong = [], explore = [], skillGap, profileCompletion } = data;
  const completion = profileCompletion?.percent ?? 0;
  const gap = skillGap?.missingSkills || [];

  return (
    <>
      {/* --------------------------- profile nudge --------------------------- */}
      {completion < 100 ? (
        <section className="card card--pad mb-24 profile-nudge">
          <div className="row gap-16 wrap grow">
            <div className="profile-nudge__ring">
              <span>{completion}%</span>
            </div>
            <div className="grow" style={{ minWidth: 220 }}>
              <div className="strong">Your profile is {completion}% complete</div>
              <p className="text-sm muted" style={{ margin: '4px 0 8px' }}>
                Recommendations get more accurate as you add your department, skills and
                career preferences.{' '}
                {profileCompletion?.missing?.length
                  ? `Still missing: ${profileCompletion.missing.slice(0, 3).join(', ')}.`
                  : ''}
              </p>
              <Progress value={completion} small />
            </div>
          </div>
          <Button variant="outline" icon="sparkles" onClick={() => navigate('/student/onboarding')}>
            Complete profile
          </Button>
        </section>
      ) : null}

      {/* ------------------------ 1. Recommended for you ---------------------- */}
      <section className="section">
        <SectionHeading
          title="Recommended for You"
          hint={`${data.considered} live vacancies compared with your profile${
            data.queries?.length
              ? ` · searched “${data.queries.map((query) => query.what).join('”, “')}”`
              : ''
          }`}
          action={
            <Button
              variant="ghost"
              size="sm"
              iconRight="chevron-right"
              onClick={() => navigate('/student/external-jobs')}
            >
              All external jobs
            </Button>
          }
        />

        {recommended.length === 0 ? (
          <EmptyState
            icon="target"
            title="No recommendations yet"
            text="Add a few preferred roles and locations to your profile, or search external jobs directly."
          >
            <Button variant="outline" icon="user" onClick={() => navigate('/student/profile')}>
              Update preferences
            </Button>
            <Button variant="outline" icon="layers" onClick={() => navigate('/student/external-jobs')}>
              Browse all jobs
            </Button>
          </EmptyState>
        ) : (
          <div className="grid grid-2">
            {recommended.slice(0, 4).map((job) => (
              <MatchJobCard key={job.id} job={job} />
            ))}
          </div>
        )}
      </section>

      {/* --------------------------- 2. Strong matches ----------------------- */}
      {strong.length > 0 ? (
        <section className="section">
          <SectionHeading
            title="Strong Matches"
            hint={`Scoring ${data.thresholds?.strong ?? 65}% or more against your skills, education and preferences`}
          />
          <div className="grid grid-2">
            {strong.slice(0, 4).map((job) => (
              <MatchJobCard key={`strong-${job.id}`} job={job} compact />
            ))}
          </div>
        </section>
      ) : null}

      {/* ---------------------------- 3. Skill gap --------------------------- */}
      <section className="section">
        <SectionHeading
          title="Skill Gap Analysis"
          hint="Derived from the requirements actually named in the listings above"
        />
        {gap.length === 0 ? (
          <div className="inline-note">
            <Icon name="check-circle" size={16} />
            <div>
              <strong>No recurring gaps found.</strong> The vacancies compared did not name a
              technology that is missing from your profile.
            </div>
          </div>
        ) : (
          <div className="card card--pad">
            <div className="gap-list">
              {gap.map((entry) => (
                <div className="gap-item" key={entry.skill}>
                  <div className="gap-item__head">
                    <span className="chip chip--neutral">{entry.skill}</span>
                    <span className="text-xs muted">
                      asked for in {entry.jobCount} of {skillGap.basedOnListings} listing
                      {skillGap.basedOnListings === 1 ? '' : 's'}
                    </span>
                  </div>
                  <Progress value={entry.shareOfListings} small />
                  {entry.exampleJobTitle ? (
                    <span className="text-xs soft">e.g. “{entry.exampleJobTitle}”</span>
                  ) : null}
                </div>
              ))}
            </div>
            <p className="text-xs soft mt-12">{skillGap.note}</p>
          </div>
        )}
      </section>

      {/* -------------------------- 4. Explore more -------------------------- */}
      {explore.length > 0 ? (
        <section className="section">
          <SectionHeading
            title="Explore More Jobs"
            hint="Lower relevance scores are not hidden - you may still want to read them"
          />
          <div className="grid grid-2">
            {explore.slice(0, 4).map((job) => (
              <MatchJobCard key={`explore-${job.id}`} job={job} compact />
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
