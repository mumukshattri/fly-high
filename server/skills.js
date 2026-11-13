/**
 * server/skills.js
 * ===========================================================================
 * SKILL DICTIONARY + EXTRACTION
 * ===========================================================================
 *
 * One canonical list of the technologies that actually appear in Indian
 * engineering job adverts, with the aliases people really type. It is used in
 * three places:
 *
 *   - resume parsing (server/extract.js) turns free text into skill names
 *   - the matching engine (server/matching.js) decides what a vacancy asks for
 *   - the API reports a matched / missing split with stable, deduplicated names
 *
 * Matching is intentional but conservative:
 *   - aliases must sit on a word boundary, so "react" never matches "reactive"
 *   - a few names are ordinary English words ("go", "r", "c", "rest"), so those
 *     only match with their exact capitalisation. A false positive here would
 *     inflate a student's match score, which is worse than a false negative.
 */

export const SKILL_CATALOG = [
  /* ------------------------------- languages ------------------------------- */
  { name: 'JavaScript', group: 'language', aliases: ['js', 'ecmascript', 'es6'] },
  { name: 'TypeScript', group: 'language', aliases: ['ts'] },
  { name: 'Python', group: 'language', aliases: ['python3'] },
  { name: 'Java', group: 'language', aliases: ['java8', 'java 8', 'core java'] },
  { name: 'C++', group: 'language', aliases: ['cpp', 'c plus plus'] },
  { name: 'C#', group: 'language', aliases: ['csharp', 'c sharp', '.net c#'] },
  { name: 'C', group: 'language', aliases: [], exactCase: true },
  { name: 'Go', group: 'language', aliases: ['golang'], exactCase: true },
  { name: 'Rust', group: 'language' },
  { name: 'Kotlin', group: 'language' },
  { name: 'Swift', group: 'language' },
  { name: 'PHP', group: 'language' },
  { name: 'Ruby', group: 'language', aliases: ['ruby on rails', 'rails'] },
  { name: 'Scala', group: 'language' },
  { name: 'R', group: 'language', aliases: [], exactCase: true },
  { name: 'MATLAB', group: 'language' },
  { name: 'SQL', group: 'language', aliases: ['pl/sql', 'plsql', 't-sql'] },
  { name: 'Shell', group: 'language', aliases: ['bash', 'shell scripting'] },
  { name: 'HTML', group: 'language', aliases: ['html5'] },
  { name: 'CSS', group: 'language', aliases: ['css3', 'scss', 'sass'] },
  { name: 'Solidity', group: 'language' },

  /* ------------------------------- frontend -------------------------------- */
  { name: 'React', group: 'framework', aliases: ['reactjs', 'react.js', 'react js'] },
  { name: 'React Native', group: 'framework' },
  { name: 'Angular', group: 'framework', aliases: ['angularjs'] },
  { name: 'Vue.js', group: 'framework', aliases: ['vue', 'vuejs'] },
  { name: 'Next.js', group: 'framework', aliases: ['nextjs', 'next js'] },
  { name: 'Redux', group: 'framework' },
  { name: 'Tailwind CSS', group: 'framework', aliases: ['tailwind', 'tailwindcss'] },
  { name: 'Bootstrap', group: 'framework' },
  { name: 'jQuery', group: 'framework' },

  /* ------------------------------- backend --------------------------------- */
  { name: 'Node.js', group: 'framework', aliases: ['nodejs', 'node js', 'node'] },
  { name: 'Express.js', group: 'framework', aliases: ['expressjs', 'express js', 'express'] },
  { name: 'Spring Boot', group: 'framework', aliases: ['springboot', 'spring'] },
  { name: 'Django', group: 'framework' },
  { name: 'Flask', group: 'framework' },
  { name: 'FastAPI', group: 'framework', aliases: ['fast api'] },
  { name: 'REST API', group: 'framework', aliases: ['restful', 'rest apis', 'rest'], exactCase: true },
  { name: 'GraphQL', group: 'framework' },
  { name: 'gRPC', group: 'framework' },
  { name: 'Microservices', group: 'framework', aliases: ['micro services', 'microservice'] },
  { name: '.NET', group: 'framework', aliases: ['dotnet', 'asp.net', 'dot net'] },
  { name: 'Laravel', group: 'framework' },
  { name: 'Ruby on Rails', group: 'framework' },

  /* ------------------------------- databases -------------------------------- */
  { name: 'MongoDB', group: 'database', aliases: ['mongo', 'mongoose'] },
  { name: 'MySQL', group: 'database' },
  { name: 'PostgreSQL', group: 'database', aliases: ['postgres', 'psql'] },
  { name: 'Oracle', group: 'database', aliases: ['oracle db', 'pl/sql oracle'] },
  { name: 'SQL Server', group: 'database', aliases: ['mssql', 'ms sql'] },
  { name: 'Redis', group: 'database' },
  { name: 'SQLite', group: 'database' },
  { name: 'Cassandra', group: 'database' },
  { name: 'DynamoDB', group: 'database' },
  { name: 'Elasticsearch', group: 'database', aliases: ['elastic search'] },
  { name: 'Firebase', group: 'database', aliases: ['firestore'] },

  /* --------------------------------- cloud ---------------------------------- */
  { name: 'AWS', group: 'cloud', aliases: ['amazon web services', 'ec2', 's3', 'lambda'] },
  { name: 'Azure', group: 'cloud', aliases: ['microsoft azure'] },
  { name: 'Google Cloud', group: 'cloud', aliases: ['gcp', 'google cloud platform'] },
  { name: 'Docker', group: 'cloud', aliases: ['containerization', 'containerisation'] },
  { name: 'Kubernetes', group: 'cloud', aliases: ['k8s'] },
  { name: 'Terraform', group: 'cloud' },
  { name: 'Jenkins', group: 'cloud' },
  { name: 'CI/CD', group: 'cloud', aliases: ['cicd', 'ci cd', 'continuous integration'] },
  { name: 'Linux', group: 'cloud', aliases: ['unix'] },

  /* --------------------------------- tools ---------------------------------- */
  { name: 'Git', group: 'tool', aliases: ['github', 'gitlab', 'version control'] },
  { name: 'Jira', group: 'tool' },
  { name: 'Postman', group: 'tool' },
  { name: 'Selenium', group: 'tool' },
  { name: 'Cypress', group: 'tool' },
  { name: 'Jest', group: 'tool' },
  { name: 'JUnit', group: 'tool' },
  { name: 'Maven', group: 'tool' },
  { name: 'Gradle', group: 'tool' },
  { name: 'Webpack', group: 'tool' },
  { name: 'Figma', group: 'tool' },
  { name: 'Excel', group: 'tool', aliases: ['ms excel', 'advanced excel'] },
  { name: 'Power BI', group: 'tool', aliases: ['powerbi'] },
  { name: 'Tableau', group: 'tool' },
  { name: 'AutoCAD', group: 'tool', aliases: ['auto cad'] },
  { name: 'SolidWorks', group: 'tool', aliases: ['solid works'] },
  { name: 'ANSYS', group: 'tool' },
  { name: 'MATLAB Simulink', group: 'tool', aliases: ['simulink'] },

  /* --------------------------------- data ----------------------------------- */
  { name: 'Machine Learning', group: 'data', aliases: ['ml', 'machine-learning'] },
  { name: 'Deep Learning', group: 'data', aliases: ['neural networks'] },
  { name: 'Data Structures', group: 'data', aliases: ['dsa', 'data structure'] },
  { name: 'Algorithms', group: 'data', aliases: ['algorithm'] },
  { name: 'Pandas', group: 'data' },
  { name: 'NumPy', group: 'data', aliases: ['numpy'] },
  { name: 'TensorFlow', group: 'data', aliases: ['tensor flow'] },
  { name: 'PyTorch', group: 'data', aliases: ['py torch'] },
  { name: 'scikit-learn', group: 'data', aliases: ['sklearn', 'scikit learn'] },
  { name: 'NLP', group: 'data', aliases: ['natural language processing'] },
  { name: 'Computer Vision', group: 'data', aliases: ['opencv'] },
  { name: 'Data Analysis', group: 'data', aliases: ['data analytics', 'data analysis'] },
  { name: 'Statistics', group: 'data', aliases: ['statistical analysis'] },
  { name: 'Big Data', group: 'data', aliases: ['hadoop', 'spark', 'pyspark'] },
  { name: 'ETL', group: 'data', aliases: ['etl pipelines'] },

  /* -------------------------------- domain ---------------------------------- */
  { name: 'Embedded Systems', group: 'domain', aliases: ['microcontrollers', 'arduino'] },
  { name: 'VLSI', group: 'domain', aliases: ['vlsi design'] },
  { name: 'Verilog', group: 'domain', aliases: ['vhdl'] },
  { name: 'IoT', group: 'domain', aliases: ['internet of things'] },
  { name: 'PLC', group: 'domain', aliases: ['plc programming', 'scada'] },
  { name: 'CAD', group: 'domain', aliases: ['cad modelling', 'cad modeling'] },
  { name: 'Thermodynamics', group: 'domain' },
  { name: 'Structural Analysis', group: 'domain', aliases: ['staad pro', 'staad'] },
  { name: 'Surveying', group: 'domain' },
  { name: 'Agile', group: 'domain', aliases: ['scrum', 'kanban'] },
  { name: 'Communication Skills', group: 'domain', aliases: ['communication'] },
];

const byKey = new Map(SKILL_CATALOG.map((skill) => [skill.name.toLowerCase(), skill]));

/** Canonical spelling for a free-text skill, or the cleaned input. */
export function canonicalSkill(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return byKey.get(text.toLowerCase())?.name || text;
}

/** Lower-case comparison key; "React.js" and "reactjs" both become "react". */
export function skillKey(value) {
  const text = String(value || '')
    .toLowerCase()
    .replace(/[\s._-]+/g, '')
    .trim();
  const direct = byKey.get(String(value || '').trim().toLowerCase());
  if (direct) return direct.name.toLowerCase().replace(/[\s._-]+/g, '');
  for (const skill of SKILL_CATALOG) {
    for (const alias of [skill.name, ...(skill.aliases || [])]) {
      if (alias.toLowerCase().replace(/[\s._-]+/g, '') === text) {
        return skill.name.toLowerCase().replace(/[\s._-]+/g, '');
      }
    }
  }
  return text;
}

/**
 * The catalogue spelling for a typed skill, including its aliases:
 * "reactjs" / "react.js" -> "React". An unknown skill keeps the student's own
 * text, so merging never renames something the dictionary does not know.
 */
export function canonicalSkillName(value) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  if (!text) return '';

  const direct = SKILL_CATALOG.find((skill) => skill.name.toLowerCase() === text.toLowerCase());
  if (direct) return direct.name;

  const textKey = text.toLowerCase().replace(/[\s._-]+/g, '');
  for (const skill of SKILL_CATALOG) {
    for (const alias of [skill.name, ...(skill.aliases || [])]) {
      if (alias.toLowerCase().replace(/[\s._-]+/g, '') === textKey) return skill.name;
    }
  }

  return text;
}

/**
 * Merge extracted skills into the student's saved skills.
 *
 *  - existing entries keep their exact spelling and order, so a hand-typed
 *    skill is never renamed or removed
 *  - comparison uses `skillKey`, so "React", "reactjs" and "react.js" are one
 *    skill, and "JS" is the same key as "JavaScript"
 *  - `excludeKeys` holds skills the student rejected in an earlier review, so a
 *    re-parse cannot quietly add them back
 *
 * @returns {{skills: string[], added: string[]}} the merged list and only the
 *          entries that were newly added (used for the review panel).
 */
export function mergeSkills(existing = [], incoming = [], { excludeKeys = [] } = {}) {
  const excluded = new Set((excludeKeys || []).map(skillKey).filter(Boolean));
  const seen = new Set();
  const skills = [];

  for (const value of existing || []) {
    const name = String(value || '').trim();
    const key = skillKey(name);
    if (!name || !key || seen.has(key)) continue;
    seen.add(key);
    skills.push(name);
  }

  const existingKeys = new Set(seen);
  const added = [];

  for (const value of incoming || []) {
    const name = canonicalSkillName(value);
    const key = skillKey(name);
    if (!name || !key || seen.has(key) || excluded.has(key)) continue;
    seen.add(key);
    skills.push(name);
    if (!existingKeys.has(key)) added.push(name);
  }

  return { skills, added };
}

/** Deduplicate a list of skills while preserving canonical names and order. */
export function uniqueSkills(values = []) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const name = canonicalSkill(value);
    if (!name) continue;
    const key = skillKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Find which catalogue skills a block of text mentions.
 *
 * @param {string} text
 * @param {{limit?: number, minLength?: number}} [options]
 * @returns {string[]} canonical skill names, in catalogue order
 */
/**
 * Split a line into the items a human would read as a list, dropping labels
 * like "Programming:". Used only for skills that are ordinary English letters.
 */
function listedTokens(text) {
  const tokens = new Set();
  const label = /^[A-Za-z][A-Za-z &/]*:\s*/;

  for (const line of String(text || '').split('\n')) {
    const stripped = line.replace(/^[\s•·▪◦*\-–—]+/, '');
    for (const part of stripped.split(/[,;|/()\n\t]|\s{2,}|\s+[–—•·]\s+/)) {
      const token = part.trim().replace(label, '').trim();
      if (token) tokens.add(token);
    }
  }

  return tokens;
}

export function extractSkillsFromText(text, { limit = 40 } = {}) {
  const haystack = String(text || '');
  if (!haystack.trim()) return [];

  const listed = listedTokens(haystack);
  const listedList = [...listed];
  const found = [];
  for (const skill of SKILL_CATALOG) {
    const candidates = [skill.name, ...(skill.aliases || [])];
    let matched = false;

    for (const candidate of candidates) {
      if (skill.exactCase) {
        // Single letters and ordinary words: only a token that is actually
        // listed counts. "CSE", "React" and "R&D" can never become a skill.
        if (
          listed.has(candidate) ||
          listedList.some((token) => token.toLowerCase() === `${candidate.toLowerCase()} programming`)
        ) {
          matched = true;
          break;
        }
        continue;
      }
      // Word boundaries only: "React" matches "React." and "React,", while
      // "react" still never matches "reactive". A trailing dot is allowed so
      // a skill at the end of a sentence is still recognised.
      const pattern = new RegExp(
        `(?<![A-Za-z0-9+#])${escapeRegExp(candidate)}(?![A-Za-z0-9+#])`,
        'i',
      );
      if (pattern.test(haystack)) {
        matched = true;
        break;
      }
    }

    if (matched) found.push(skill.name);
    if (found.length >= limit) break;
  }

  return found;
}

/** Every skill name the dictionary knows, for UI suggestions. */
export function allSkillNames() {
  return SKILL_CATALOG.map((skill) => skill.name);
}
