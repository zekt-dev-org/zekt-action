import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { readOrchestrationStepRef } from '../src/utils';

// Silence @actions/core output during tests but capture warnings for assertions.
jest.mock('@actions/core', () => {
  const warnings: string[] = [];
  return {
    __warnings: warnings,
    warning: (msg: string) => warnings.push(msg),
    info: () => undefined,
    getInput: () => '',
    setSecret: () => undefined,
  };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const core = require('@actions/core') as { __warnings: string[] };

function writeEventFile(payload: unknown): string {
  const filePath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'zekt-event-')),
    'event.json'
  );
  fs.writeFileSync(filePath, JSON.stringify(payload), 'utf-8');
  return filePath;
}

describe('readOrchestrationStepRef — Step 2 acceptance tests', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    core.__warnings.length = 0;
    delete process.env.GITHUB_EVENT_NAME;
    delete process.env.GITHUB_EVENT_PATH;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  // #1 Standard workflow_dispatch — no event context
  it('returns null when GITHUB_EVENT_NAME is not repository_dispatch', () => {
    process.env.GITHUB_EVENT_NAME = 'workflow_dispatch';
    process.env.GITHUB_EVENT_PATH = writeEventFile({ inputs: { foo: 'bar' } });

    expect(readOrchestrationStepRef()).toBeNull();
    expect(core.__warnings).toHaveLength(0);
  });

  // #2 repository_dispatch without _zekt — manual gh api call
  it('returns null when repository_dispatch client_payload has no _zekt', () => {
    process.env.GITHUB_EVENT_NAME = 'repository_dispatch';
    process.env.GITHUB_EVENT_PATH = writeEventFile({
      client_payload: { input: { billing_account: 'ba-123' } },
    });

    expect(readOrchestrationStepRef()).toBeNull();
    expect(core.__warnings).toHaveLength(0);
  });

  // #3 repository_dispatch with valid _zekt.orchestration — camelCase → snake_case remap
  it('returns snake_case ref when _zekt.orchestration has both executionId and stepId', () => {
    process.env.GITHUB_EVENT_NAME = 'repository_dispatch';
    process.env.GITHUB_EVENT_PATH = writeEventFile({
      client_payload: {
        input: { billing_account: 'ba-123' },
        _zekt: {
          orchestration: {
            executionId: 'exec-abc123',
            stepId: 'create-sub',
            requestorRepository: 'dev-team-org/dev-repo',
          },
        },
      },
    });

    expect(readOrchestrationStepRef()).toEqual({
      execution_id: 'exec-abc123',
      step_id: 'create-sub',
    });
    expect(core.__warnings).toHaveLength(0);
  });

  // #4a Partial ref — missing stepId
  it('returns null and warns when stepId is missing', () => {
    process.env.GITHUB_EVENT_NAME = 'repository_dispatch';
    process.env.GITHUB_EVENT_PATH = writeEventFile({
      client_payload: {
        _zekt: { orchestration: { executionId: 'exec-abc123' } },
      },
    });

    expect(readOrchestrationStepRef()).toBeNull();
    expect(core.__warnings).toHaveLength(1);
    expect(core.__warnings[0]).toMatch(/incomplete/i);
  });

  // #4b Partial ref — missing executionId
  it('returns null and warns when executionId is missing', () => {
    process.env.GITHUB_EVENT_NAME = 'repository_dispatch';
    process.env.GITHUB_EVENT_PATH = writeEventFile({
      client_payload: {
        _zekt: { orchestration: { stepId: 'create-sub' } },
      },
    });

    expect(readOrchestrationStepRef()).toBeNull();
    expect(core.__warnings).toHaveLength(1);
    expect(core.__warnings[0]).toMatch(/incomplete/i);
  });

  // #4c Partial ref — empty strings
  it('returns null and warns when executionId is an empty string', () => {
    process.env.GITHUB_EVENT_NAME = 'repository_dispatch';
    process.env.GITHUB_EVENT_PATH = writeEventFile({
      client_payload: {
        _zekt: { orchestration: { executionId: '', stepId: 'create-sub' } },
      },
    });

    expect(readOrchestrationStepRef()).toBeNull();
    expect(core.__warnings).toHaveLength(1);
  });
});
