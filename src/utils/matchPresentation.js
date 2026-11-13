/**
 * utils/matchPresentation.js
 * ===========================================================================
 * MATCH PAYLOAD -> WHAT THE CARD SHOWS
 * ===========================================================================
 * Pure, testable mapping from `GET /api/student/recommendations` to the labels,
 * tones and rows the card renders.
 *
 * Nothing here calculates a score. Every number and every sentence comes from
 * the server's `match` object (the same 40/20/15/10/10/5 engine), so the browser
 * can never contradict the ranking. A factor the listing does not describe is
 * shown as "Not stated in the listing" / "Not scored", never as zero.
 */

export const CATEGORY_TONE = {
  'Excellent Match': 'excellent',
  'Strong Match': 'strong',
  'Moderate Match': 'moderate',
  Explore: 'explore',
};

/** The label and colour class for a match category, exactly as the API names it. */
export function matchCategory(level) {
  return {
    label: level || 'Explore',
    tone: CATEGORY_TONE[level] || 'explore',
  };
}

/** The score breakdown, one row per factor, with its real weight and score. */
export function factorRows(match = {}) {
  return (match.factors || []).map((factor) => ({
    key: factor.key,
    label: factor.label || factor.key,
    weight: Math.round((Number(factor.weight) || 0) * 100),
    score: typeof factor.score === 'number' ? factor.score : null,
    scored: typeof factor.score === 'number',
    detail: factor.detail || '',
  }));
}

const RELEVANCE_TEXT = {
  High: { value: 'High relevance', tone: 'good' },
  Medium: { value: 'Some relevance', tone: 'warn' },
  Low: { value: 'Low relevance', tone: 'low' },
  Unknown: { value: 'Not stated in the listing', tone: 'unknown' },
};

const PREFERENCE_TEXT = {
  true: { value: 'Matches your preference', tone: 'good' },
  false: { value: 'Outside your preference', tone: 'warn' },
  null: { value: 'Not stated in the listing', tone: 'unknown' },
};

/** Education, experience, location and employment relevance for the card grid. */
export function relevanceRows(match = {}) {
  const factors = new Map((match.factors || []).map((factor) => [factor.key, factor]));
  const scoreOf = (key) => {
    const score = factors.get(key)?.score;
    return typeof score === 'number' ? score : null;
  };
  const detailOf = (key) => factors.get(key)?.detail || '';

  const education = RELEVANCE_TEXT[match.educationRelevance] || RELEVANCE_TEXT.Unknown;
  const experience = RELEVANCE_TEXT[match.experienceRelevance] || RELEVANCE_TEXT.Unknown;
  const location = PREFERENCE_TEXT[String(match.locationMatch ?? null)] || PREFERENCE_TEXT.null;
  const employment = PREFERENCE_TEXT[String(match.employmentMatch ?? null)] || PREFERENCE_TEXT.null;

  return [
    {
      key: 'education',
      label: 'Education & department',
      ...education,
      score: scoreOf('education'),
      detail: detailOf('education'),
    },
    {
      key: 'experience',
      label: 'Projects & experience',
      ...experience,
      score: scoreOf('experience'),
      detail: detailOf('experience'),
    },
    {
      key: 'location',
      label: 'Location',
      ...location,
      score: scoreOf('location'),
      detail: detailOf('location'),
    },
    {
      key: 'employment',
      label: 'Employment type',
      ...employment,
      score: scoreOf('employment'),
      detail: detailOf('employment'),
    },
  ];
}

/** The two short, human-readable sentences shown above the fold. */
export function whyReasons(match = {}) {
  return (Array.isArray(match.reasons) ? match.reasons : []).filter(Boolean).slice(0, 2);
}

/** How many factors the listing actually let the engine score. */
export function scoredFactorSummary(match = {}) {
  const rows = factorRows(match);
  return {
    scored: rows.filter((row) => row.scored).length,
    total: rows.length,
  };
}

/** "3 of 6 factors scored" - shown in the collapsible header. */
export function scoredFactorText(match = {}) {
  const { scored, total } = scoredFactorSummary(match);
  if (!total) return '';
  return `${scored} of ${total} factors scored`;
}
