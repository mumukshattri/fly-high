import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalSkillName, mergeSkills, skillKey } from '../server/skills.js';

test('mergeSkills adds extracted skills to an empty profile', () => {
  const { skills, added } = mergeSkills([], ['Python', 'React', 'Docker']);

  assert.deepEqual(skills, ['Python', 'React', 'Docker']);
  assert.deepEqual(added, ['Python', 'React', 'Docker']);
});

test('mergeSkills keeps every manually entered skill and its spelling', () => {
  const existing = ['MyOwnSkill', 'reactjs'];
  const { skills, added } = mergeSkills(existing, ['React', 'Python']);

  assert.deepEqual(skills, ['MyOwnSkill', 'reactjs', 'Python']);
  assert.deepEqual(added, ['Python']);
});

test('aliases and case collapse to one entry', () => {
  const { skills } = mergeSkills(['JS', 'Node.js'], ['JavaScript', 'nodejs', 'NODE JS', 'React.JS']);

  assert.deepEqual(
    skills.map((skill) => skillKey(skill)),
    ['javascript', 'nodejs', 'react'],
  );
  assert.equal(skills[0], 'JS', 'the existing spelling is preserved');
});

test('a rejected skill key is never re-added by a later parse', () => {
  const rejected = ['Kubernetes'];
  const { skills, added } = mergeSkills([], ['Docker', 'Kubernetes', 'k8s'], {
    excludeKeys: rejected,
  });

  assert.deepEqual(skills, ['Docker']);
  assert.deepEqual(added, ['Docker']);
});

test('exclusions only affect incoming skills, never saved ones', () => {
  // The student rejected Kubernetes once, then typed "kubernetes" themselves.
  const { skills } = mergeSkills(['kubernetes'], ['Kubernetes'], {
    excludeKeys: ['k8s'],
  });

  assert.deepEqual(skills, ['kubernetes']);
});

test('empty and malformed input are safe', () => {
  assert.deepEqual(mergeSkills(undefined, undefined), { skills: [], added: [] });
  assert.deepEqual(mergeSkills(['', null], ['', '  ']).skills, []);
});

test('canonicalSkillName normalises aliases but preserves unknown text', () => {
  assert.equal(canonicalSkillName('reactjs'), 'React');
  assert.equal(canonicalSkillName('node js'), 'Node.js');
  assert.equal(canonicalSkillName('  python '), 'Python');
  assert.equal(canonicalSkillName('Invented Framework'), 'Invented Framework');
  assert.equal(canonicalSkillName(''), '');
});
