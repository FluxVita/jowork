import { describe, it, expect } from 'vitest';
import { extractLinks } from '../sync/linker.js';

describe('extractLinks', () => {
  it('extracts GitHub PR references', () => {
    const links = extractLinks('Fixed in PR #123 and PR #456');
    const prs = links.filter((l) => l.linkType === 'pr');
    expect(prs.length).toBe(2);
    expect(prs[0].identifier).toBe('123');
    expect(prs[0].confidence).toBe('high');
  });

  it('extracts issue references with "issue" keyword', () => {
    const links = extractLinks('See issue #4200 for details');
    expect(links.some((l) => l.linkType === 'issue' && l.identifier === '4200')).toBe(true);
  });

  it('extracts Linear-style keys', () => {
    const links = extractLinks('Working on LIN-234 and PROJ-56');
    const issues = links.filter((l) => l.linkType === 'issue');
    expect(issues.some((l) => l.identifier === 'LIN-234')).toBe(true);
    expect(issues.some((l) => l.identifier === 'PROJ-56')).toBe(true);
  });

  it('extracts URLs', () => {
    const links = extractLinks('Check https://github.com/org/repo/pull/123');
    const urls = links.filter((l) => l.linkType === 'url');
    expect(urls.length).toBe(1);
    expect(urls[0].confidence).toBe('high');
  });

  it('extracts @mentions', () => {
    const links = extractLinks('cc @john_doe and @alice');
    const mentions = links.filter((l) => l.linkType === 'mention');
    expect(mentions.length).toBe(2);
  });

  it('deduplicates same identifiers', () => {
    const links = extractLinks('PR #123 and PR #123 again');
    const prs = links.filter((l) => l.linkType === 'pr');
    expect(prs.length).toBe(1);
  });

  it('handles empty content', () => {
    expect(extractLinks('')).toEqual([]);
  });

  it('skips identifiers shorter than 3 characters', () => {
    // bare #12 matches \d{2,6} regex but identifier "12" is length 2 < 3 → filtered
    const links = extractLinks('#12');
    const issues = links.filter((l) => l.linkType === 'issue');
    expect(issues.length).toBe(0);
  });

  it('extracts bare hash references with enough digits', () => {
    const links = extractLinks('see #1234 for context');
    const issues = links.filter((l) => l.linkType === 'issue' && l.identifier === '1234');
    expect(issues.length).toBe(1);
    expect(issues[0].confidence).toBe('medium');
  });

  it('does not extract commit SHAs in short content', () => {
    // commit SHA pattern is skipped for content.length < 100
    const links = extractLinks('abc1234');
    const commits = links.filter((l) => l.linkType === 'commit');
    expect(commits.length).toBe(0);
  });
});
