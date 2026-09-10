// Mock @actions/core — capture warnings, silence everything else, feed action inputs.
jest.mock('@actions/core', () => {
  const warnings: string[] = [];
  const errors: string[] = [];
  const outputs: Record<string, string> = {};
  return {
    __warnings: warnings,
    __errors: errors,
    __outputs: outputs,
    warning: (msg: string) => warnings.push(msg),
    error: (msg: string) => errors.push(msg),
    info: () => undefined,
    setOutput: (name: string, value: unknown) => {
      outputs[name] = String(value);
    },
    setSecret: () => undefined,
    getInput: () => '',
    summary: {
      addHeading: function () { return this; },
      addTable: function () { return this; },
      addRaw: function () { return this; },
      write: async () => undefined,
    },
  };
});

// Mock @actions/github to give runOrchestration a stable runId/repo.
jest.mock('@actions/github', () => ({
  context: {
    runId: 123456789,
    repo: { owner: 'test-org', repo: 'test-repo' },
  },
}));

// Mock api-client — spy on the submit call and control the response.
jest.mock('../src/api-client', () => ({
  submitOrchestration: jest.fn(),
  getOrchestrationStatus: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const core = require('@actions/core') as {
  __warnings: string[];
  __errors: string[];
  __outputs: Record<string, string>;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const apiClient = require('../src/api-client') as {
  submitOrchestration: jest.Mock;
  getOrchestrationStatus: jest.Mock;
};

import { runOrchestration } from '../src/orchestrate';
import { ActionInputs } from '../src/types';

function baseInputs(payload: unknown): ActionInputs {
  return {
    eventType: '',
    payload: JSON.stringify(payload),
    zektApiUrl: 'https://api.example.test',
    orchestrationApiUrl: 'https://orch.example.test',
    shield: false,
    orchestrate: true,
    executionMode: 'sequential',
    wait: false,
  };
}

const validPlan = {
  default_service_owner: 'platform-team-org',
  services: [
    {
      step_id: 'create-sub',
      service_slug: 'new-azure-subscription',
      input: { billing_account: 'ba-123' },
    },
  ],
};

beforeEach(() => {
  core.__warnings.length = 0;
  core.__errors.length = 0;
  for (const k of Object.keys(core.__outputs)) delete core.__outputs[k];
  apiClient.submitOrchestration.mockReset();
  apiClient.getOrchestrationStatus.mockReset();
  apiClient.submitOrchestration.mockResolvedValue({ execution_id: 'exec-xyz' });
});

describe('Step 5a — surfacing warnings[] from submit response', () => {
  it('emits no annotations when response has no warnings key', async () => {
    apiClient.submitOrchestration.mockResolvedValue({ execution_id: 'exec-xyz' });
    await runOrchestration(baseInputs(validPlan), 'token');
    expect(core.__warnings).toHaveLength(0);
    expect(core.__outputs.execution_id).toBe('exec-xyz');
  });

  it('emits no annotations when warnings is an empty array', async () => {
    apiClient.submitOrchestration.mockResolvedValue({
      execution_id: 'exec-xyz',
      warnings: [],
    });
    await runOrchestration(baseInputs(validPlan), 'token');
    expect(core.__warnings).toHaveLength(0);
  });

  it('emits one annotation per warning and does not throw', async () => {
    apiClient.submitOrchestration.mockResolvedValue({
      execution_id: 'exec-xyz',
      warnings: [
        "Service 'foo' does not declare supportsOrchestration: true.",
        "Step 'create-rg' references 'create-sub.outputs.subscription_id', but service 'new-azure-subscription' does not declare 'subscription_id'.",
      ],
    });
    await runOrchestration(baseInputs(validPlan), 'token');
    expect(core.__warnings).toHaveLength(2);
    expect(core.__warnings[0]).toContain('Zekt orchestration:');
    expect(core.__warnings[0]).toContain("Service 'foo'");
    expect(core.__warnings[1]).toContain("does not declare 'subscription_id'");
  });

  it('preserves special characters (quotes, %, newline) in the warning text', async () => {
    const raw = 'weird "quoted" 50% message\nwith newline';
    apiClient.submitOrchestration.mockResolvedValue({
      execution_id: 'exec-xyz',
      warnings: [raw],
    });
    await runOrchestration(baseInputs(validPlan), 'token');
    expect(core.__warnings).toHaveLength(1);
    expect(core.__warnings[0]).toContain(raw);
  });
});

describe('Step 5b — forwarding strict_output_schema_resolution', () => {
  it('omits the field from the request body when the payload does not set it', async () => {
    await runOrchestration(baseInputs(validPlan), 'token');
    const req = apiClient.submitOrchestration.mock.calls[0][3];
    expect(req).not.toHaveProperty('strict_output_schema_resolution');
  });

  it('forwards true as a JSON boolean', async () => {
    await runOrchestration(
      baseInputs({ ...validPlan, strict_output_schema_resolution: true }),
      'token'
    );
    const req = apiClient.submitOrchestration.mock.calls[0][3];
    expect(req.strict_output_schema_resolution).toBe(true);
    expect(typeof req.strict_output_schema_resolution).toBe('boolean');
  });

  it('forwards false explicitly rather than dropping it', async () => {
    await runOrchestration(
      baseInputs({ ...validPlan, strict_output_schema_resolution: false }),
      'token'
    );
    const req = apiClient.submitOrchestration.mock.calls[0][3];
    expect(req.strict_output_schema_resolution).toBe(false);
  });

  it('rejects a string "true" with a client-side error', async () => {
    await expect(
      runOrchestration(
        baseInputs({ ...validPlan, strict_output_schema_resolution: 'true' }),
        'token'
      )
    ).rejects.toThrow(/must be a JSON boolean/);
    expect(apiClient.submitOrchestration).not.toHaveBeenCalled();
  });

  it('rejects a numeric 1 with a client-side error', async () => {
    await expect(
      runOrchestration(
        baseInputs({ ...validPlan, strict_output_schema_resolution: 1 }),
        'token'
      )
    ).rejects.toThrow(/must be a JSON boolean/);
    expect(apiClient.submitOrchestration).not.toHaveBeenCalled();
  });
});
