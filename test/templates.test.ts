import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const load = (f: string) => parse(readFileSync(new URL(`../templates/${f}`, import.meta.url), 'utf8'));
// `on` is a plain key in YAML 1.2, which `yaml` uses by default

describe.each(['process.yml', 'summary.yml'])('%s', (f) => {
  const wf = load(f);
  it('has least-privilege permissions and a non-cancelling concurrency group', () => {
    expect(wf.permissions).toEqual({ issues: 'write', contents: 'read' });
    expect(wf.concurrency['cancel-in-progress']).toBe(false);
  });
  it('never interpolates event data into a shell script', () => {
    for (const job of Object.values<{ steps: { run?: string }[] }>(wf.jobs)) {
      for (const s of job.steps) expect(s.run ?? '').not.toContain('${{');
    }
  });
});

describe('process.yml', () => {
  const wf = load('process.yml');
  const job = wf.jobs.process;
  it('triggers on issues opened and issue_comment created', () => {
    expect(wf.on).toEqual({ issues: { types: ['opened'] }, issue_comment: { types: ['created'] } });
    expect(wf.concurrency.group).toBe('todoman-${{ github.event.issue.number }}');
  });
  it('gates on the owner, labels and issue state per the PRD', () => {
    const c: string = job.if;
    expect(c).toContain("github.event.issue.user.login == (vars.TODOMAN_OWNER || 'masnun-siam')");
    expect(c).toContain("github.event.comment.user.login == (vars.TODOMAN_OWNER || 'masnun-siam')");
    expect(c).toContain("github.event.issue.state == 'open'");
    for (const l of ['needs-info', 'failed', 'todoman:processing']) expect(c).toContain(`contains(github.event.issue.labels.*.name, '${l}')`);
    for (const l of ['task', 'meeting', 'tracking', 'summary', 'processed']) expect(c).toContain(`!contains(github.event.issue.labels.*.name, '${l}')`);
  });
  it('runs the action in process mode and ends with a failure/cancel step', () => {
    expect(job.steps[0]).toMatchObject({ uses: 'masnun-siam/todoman@v1', with: { mode: 'process' } });
    const last = job.steps.at(-1);
    expect(last.if).toBe('failure() || cancelled()');
    expect(last.with).toEqual({ mode: 'process', 'on-failure': 'true' });
  });
});

describe('summary.yml', () => {
  const wf = load('summary.yml');
  it('runs weekly on Thursday 12:00 UTC and on dispatch with summary|doctor, from, to', () => {
    expect(wf.on.schedule).toEqual([{ cron: '0 12 * * 4' }]);
    const i = wf.on.workflow_dispatch.inputs;
    expect(i.mode.options).toEqual(['summary', 'doctor']);
    expect(Object.keys(i)).toEqual(['mode', 'from', 'to']);
    expect(wf.jobs.run.steps[0].with.mode).toBe("${{ inputs.mode || 'summary' }}");
  });
  it("uses its own concurrency group, not a dump's", () => {
    expect(wf.concurrency.group).toBe("todoman-${{ inputs.mode || 'summary' }}");
  });
});

describe('people.yml', () => {
  it('has two example entries', () => {
    const p = load('people.yml');
    expect(p).toHaveLength(2);
    for (const e of p) expect(e).toEqual({ name: expect.any(String), aliases: expect.any(Array), email: expect.any(String) });
  });
});
