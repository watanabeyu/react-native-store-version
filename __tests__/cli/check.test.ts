/**
 * @jest-environment node
 */
// `check` のチェックの順番と --ignore
import { runChecks } from '../../src/cli/check.ts';
import { createProject, type Project } from '../__helpers__/project.ts';

describe('runChecks', () => {
  let project: Project;

  beforeEach(() => {
    project = createProject({
      'react-native-store-version': {
        name: 'react-native-store-version',
        version: '2.0.0',
      },
    });
  });

  afterEach(() => {
    project.remove();
  });

  it('runs C1, C3 and C7 in this order (C3 has no ID until C2 is added in 4b, so it is skipped)', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch');
    await expect(
      runChecks({ cwd: project.dir, country: 'us', ignore: new Set() })
    ).resolves.toEqual([
      {
        id: 'C1',
        level: 'ok',
        message: 'react-native-store-version 2.0.0 is installed',
      },
      {
        id: 'C3',
        level: 'skipped',
        message: 'no iOS bundleId or Android package to look up',
      },
      expect.objectContaining({ id: 'C7', level: 'info' }),
    ]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not run the ignored checks', async () => {
    const entries = await runChecks({
      cwd: project.dir,
      country: 'us',
      ignore: new Set(['C1', 'C7']),
    });
    expect(entries.map((e) => e.id)).toEqual(['C3']);
    await expect(
      runChecks({
        cwd: project.dir,
        country: 'us',
        ignore: new Set(['C1', 'C3', 'C7']),
      })
    ).resolves.toEqual([]);
  });
});
