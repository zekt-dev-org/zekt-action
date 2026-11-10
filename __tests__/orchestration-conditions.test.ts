// Spec 162 — orchestration step conditions (ZA1–ZA8).
// The agreed brief is zektMainWeb/specs/162-orchestration-step-conditions/plan.md § 3.7;
// specs/162-orchestration-step-conditions/README.md in this repo points at it.

// Mock @actions/core — capture info/warning/error, outputs and the summary tables.
jest.mock('@actions/core', () => {
  const infos: string[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const outputs: Record<string, string> = {};
  const tables: unknown[][] = [];
  return {
    __infos: infos,
    __warnings: warnings,
    __errors: errors,
    __outputs: outputs,
    __tables: tables,
    info: (msg: string) => infos.push(msg),
    warning: (msg: string) => warnings.push(msg),
    error: (msg: string) => errors.push(msg),
    setOutput: (name: string, value: unknown) => {
      outputs[name] = String(value);
    },
    setSecret: () => undefined,
    getInput: () => '',
    summary: {
      addHeading: function () {
        return this;
      },
      addTable: function (rows: unknown[]) {
        tables.push(rows);
        return this;
      },
      addRaw: function () {
        return this;
      },
      write: async () => undefined,
    },
  };
});

jest.mock('@actions/github', () => ({
  context: {
    runId: 123456789,
    repo: { owner: 'test-org', repo: 'test-repo' },
  },
}));

jest.mock('../src/api-client', () => ({
  submitOrchestration: jest.fn(),
  getOrchestrationStatus: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const core = require('@actions/core') as {
  __infos: string[];
  __warnings: string[];
  __errors: string[];
  __outputs: Record<string, string>;
  __tables: unknown[][];
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const apiClient = require('../src/api-client') as {
  submitOrchestration: jest.Mock;
  getOrchestrationStatus: jest.Mock;
};

import { runOrchestration } from '../src/orchestrate';
import { ActionInputs } from '../src/types';

function inputs(payload: unknown, wait = false): ActionInputs {
  return {
    eventType: '',
    payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
    zektApiUrl: 'https://api.example.test',
    orchestrationApiUrl: 'https://orch.example.test',
    shield: false,
    orchestrate: true,
    executionMode: 'sequential',
    wait,
  };
}

/** build → scan (conditioned) → ship (depends on scan). */
const conditionedPlan = {
  default_service_owner: 'platform-team-org',
  services: [
    { step_id: 'build', service_slug: 'builder', input: {} },
    {
      step_id: 'scan',
      service_slug: 'scanner',
      input: {},
      condition: false,
      condition_description: 'Only for production subscriptions',
    },
    { step_id: 'ship', service_slug: 'shipper', input: {}, depends_on: ['scan'] },
  ],
};

/** The status response Core returns for the plan above. */
const conditionedStatus = {
  execution_id: 'exec-xyz',
  status: 'completed',
  excluded_steps: 2,
  steps: [
    { step_id: 'build', status: 'completed', outputs: { image: 'img:1' } },
    {
      step_id: 'scan',
      status: 'excluded',
      condition: false,
      condition_description: 'Only for production subscriptions',
      exclusion_reason: 'condition_false',
      excluded_by: null,
    },
    {
      step_id: 'ship',
      status: 'excluded',
      condition: null,
      condition_description: null,
      exclusion_reason: 'dependency_excluded',
      excluded_by: 'scan',
    },
  ],
};

/** The Steps table is the second addTable call; row 0 is the header. */
function stepsTable(): string[][] {
  const table = core.__tables[1] as unknown[];
  return table.slice(1) as string[][];
}

function stepsHeader(): string[] {
  const table = core.__tables[1] as unknown[];
  return (table[0] as { data: string }[]).map((c) => c.data);
}

beforeEach(() => {
  core.__infos.length = 0;
  core.__warnings.length = 0;
  core.__errors.length = 0;
  core.__tables.length = 0;
  for (const k of Object.keys(core.__outputs)) delete core.__outputs[k];
  apiClient.submitOrchestration.mockReset();
  apiClient.getOrchestrationStatus.mockReset();
  apiClient.submitOrchestration.mockResolvedValue({ execution_id: 'exec-xyz' });
});

describe('ZA1/ZA2 — condition reaches the request body unchanged', () => {
  it('forwards condition and condition_description verbatim', async () => {
    await runOrchestration(inputs(conditionedPlan), 'token');
    const req = apiClient.submitOrchestration.mock.calls[0][3];
    expect(req.services).toHaveLength(3);
    expect(req.services[1].condition).toBe(false);
    expect(typeof req.services[1].condition).toBe('boolean');
    expect(req.services[1].condition_description).toBe('Only for production subscriptions');
  });

  it('forwards condition: true as a boolean', async () => {
    const plan = {
      default_service_owner: 'o',
      services: [{ step_id: 'a', service_slug: 'svc', input: {}, condition: true }],
    };
    await runOrchestration(inputs(plan), 'token');
    const req = apiClient.submitOrchestration.mock.calls[0][3];
    expect(req.services[0].condition).toBe(true);
  });

  it('forwards timeout_minutes and input_schema_version, now declared (ZA1)', async () => {
    const plan = {
      default_service_owner: 'o',
      services: [
        {
          step_id: 'a',
          service_slug: 'svc',
          input: {},
          timeout_minutes: 30,
          input_schema_version: '2',
        },
      ],
    };
    await runOrchestration(inputs(plan), 'token');
    const req = apiClient.submitOrchestration.mock.calls[0][3];
    expect(req.services[0].timeout_minutes).toBe(30);
    expect(req.services[0].input_schema_version).toBe('2');
  });

  it('does not drop or reorder an excluded step — the plan is sent whole (ZA2)', async () => {
    await runOrchestration(inputs(conditionedPlan), 'token');
    const req = apiClient.submitOrchestration.mock.calls[0][3];
    expect(req.services.map((s: { step_id: string }) => s.step_id)).toEqual([
      'build',
      'scan',
      'ship',
    ]);
  });

  it('does not fill depends_on for a step that has none (ZA2)', async () => {
    await runOrchestration(inputs(conditionedPlan), 'token');
    const req = apiClient.submitOrchestration.mock.calls[0][3];
    expect(req.services[0]).not.toHaveProperty('depends_on');
    expect(req.services[1]).not.toHaveProperty('depends_on');
  });
});

describe('ZA3 — D9/D10 validation stays with Core', () => {
  it('does not refuse a string condition on the client; Core names the step', async () => {
    const plan = {
      default_service_owner: 'o',
      services: [{ step_id: 'a', service_slug: 'svc', input: {}, condition: 'false' }],
    };
    await runOrchestration(inputs(plan), 'token');
    expect(apiClient.submitOrchestration).toHaveBeenCalledTimes(1);
    const req = apiClient.submitOrchestration.mock.calls[0][3];
    expect(req.services[0].condition).toBe('false');
  });

  it('does not refuse a condition_description over 200 characters', async () => {
    const plan = {
      default_service_owner: 'o',
      services: [
        {
          step_id: 'a',
          service_slug: 'svc',
          input: {},
          condition: true,
          condition_description: 'x'.repeat(240),
        },
      ],
    };
    await runOrchestration(inputs(plan), 'token');
    expect(apiClient.submitOrchestration).toHaveBeenCalledTimes(1);
  });

  it('emits no predictive warning about a non-boolean condition', async () => {
    const plan = {
      default_service_owner: 'o',
      services: [{ step_id: 'a', service_slug: 'svc', input: {}, condition: 'false' }],
    };
    await runOrchestration(inputs(plan), 'token');
    expect(core.__warnings).toHaveLength(0);
  });
});

describe('ZA4 — the empty-render hint', () => {
  it('adds the hint when a condition rendered empty before a comma', async () => {
    const raw = '{"services":[{"step_id":"a","service_slug":"svc","condition": ,"input":{}}]}';
    await expect(runOrchestration(inputs(raw), 'token')).rejects.toThrow(/rendered empty/);
    expect(apiClient.submitOrchestration).not.toHaveBeenCalled();
  });

  it('adds the hint when a condition rendered empty before a closing brace', async () => {
    const raw = '{"services":[{"step_id":"a","service_slug":"svc","input":{},"condition": }]}';
    await expect(runOrchestration(inputs(raw), 'token')).rejects.toThrow(
      /without quotes, using an expression that gives true or false/
    );
  });

  it('adds the hint across a newline, as a rendered multi-line payload gives', async () => {
    const raw = '{"services":[{"step_id":"a","service_slug":"svc","input":{},\n  "condition":\n}]}';
    await expect(runOrchestration(inputs(raw), 'token')).rejects.toThrow(/rendered empty/);
  });

  it('keeps the plain parse error when no condition is involved', async () => {
    const raw = '{"services":[{"step_id":"a",}]}';
    const err = await runOrchestration(inputs(raw), 'token').catch((e: Error) => e);
    expect((err as Error).message).toMatch(/not valid JSON/);
    expect((err as Error).message).not.toMatch(/rendered empty/);
  });
});

describe('ZA5 — step status outputs under wait: true', () => {
  beforeEach(() => {
    apiClient.getOrchestrationStatus.mockResolvedValue(conditionedStatus);
  });

  it('writes a status output for every step, included and excluded alike', async () => {
    await runOrchestration(inputs(conditionedPlan, true), 'token');
    expect(core.__outputs.step_build_status).toBe('completed');
    expect(core.__outputs.step_scan_status).toBe('excluded');
    expect(core.__outputs.step_ship_status).toBe('excluded');
  });

  it('writes outputs only for the step that produced them', async () => {
    await runOrchestration(inputs(conditionedPlan, true), 'token');
    expect(core.__outputs.step_build_outputs_image).toBe('img:1');
    expect(core.__outputs).not.toHaveProperty('step_scan_outputs_image');
    expect(core.__outputs).not.toHaveProperty('step_ship_outputs_image');
  });

  it('writes excluded_steps from the status response', async () => {
    await runOrchestration(inputs(conditionedPlan, true), 'token');
    expect(core.__outputs.excluded_steps).toBe('2');
  });

  it('writes excluded_steps "0" when the field is absent', async () => {
    apiClient.getOrchestrationStatus.mockResolvedValue({
      execution_id: 'exec-xyz',
      status: 'completed',
      steps: [{ step_id: 'build', status: 'completed' }],
    });
    await runOrchestration(inputs(conditionedPlan, true), 'token');
    expect(core.__outputs.excluded_steps).toBe('0');
  });

  it('logs one info line per excluded step and never a warning or error', async () => {
    await runOrchestration(inputs(conditionedPlan, true), 'token');
    expect(core.__infos).toContain("step 'scan' excluded by its condition");
    expect(core.__infos).toContain(
      "step 'ship' excluded because 'scan' was excluded by its condition"
    );
    expect(core.__warnings).toHaveLength(0);
    expect(core.__errors).toHaveLength(0);
  });

  it('logs an unknown exclusion_reason verbatim rather than dropping it (F1)', async () => {
    apiClient.getOrchestrationStatus.mockResolvedValue({
      execution_id: 'exec-xyz',
      status: 'completed',
      excluded_steps: 1,
      steps: [
        { step_id: 'build', status: 'excluded', exclusion_reason: 'parent_excluded' },
      ],
    });
    await runOrchestration(inputs(conditionedPlan, true), 'token');
    expect(core.__infos).toContain("step 'build' excluded (parent_excluded)");
  });

  it('reports an all-excluded fire-and-forget submit without changing an output', async () => {
    apiClient.submitOrchestration.mockResolvedValue({
      execution_id: 'exec-xyz',
      status: 'completed',
    });
    await runOrchestration(inputs(conditionedPlan, false), 'token');
    expect(core.__infos).toContain(
      'All 3 steps were excluded by their conditions; nothing was sent.'
    );
    expect(core.__outputs).not.toHaveProperty('excluded_steps');
    expect(core.__outputs).not.toHaveProperty('execution_status');
  });

  it('says nothing about exclusion on an ordinary fire-and-forget submit', async () => {
    apiClient.submitOrchestration.mockResolvedValue({
      execution_id: 'exec-xyz',
      status: 'pending',
    });
    await runOrchestration(inputs(conditionedPlan, false), 'token');
    expect(core.__infos.join('\n')).not.toMatch(/excluded/);
  });
});

describe('ZA6 — the job summary', () => {
  it('shows the condition and its description, and the status when it waited', async () => {
    apiClient.getOrchestrationStatus.mockResolvedValue(conditionedStatus);
    await runOrchestration(inputs(conditionedPlan, true), 'token');

    expect(stepsHeader()).toEqual([
      'step_id',
      'service_slug',
      'owner',
      'condition',
      'status',
    ]);
    const rows = stepsTable();
    expect(rows[0]).toEqual(['build', 'builder', 'platform-team-org', '', 'completed']);
    expect(rows[1][3]).toBe('false — Only for production subscriptions');
    expect(rows[1][4]).toBe('excluded');
    expect(rows[2][4]).toBe('excluded (by scan)');
  });

  it('omits the status column on a fire-and-forget run', async () => {
    await runOrchestration(inputs(conditionedPlan, false), 'token');
    expect(stepsHeader()).toEqual(['step_id', 'service_slug', 'owner', 'condition']);
  });

  it('HTML-escapes a caller-supplied condition_description', async () => {
    const plan = {
      default_service_owner: 'o',
      services: [
        {
          step_id: 'a',
          service_slug: 'svc',
          input: {},
          condition: true,
          condition_description: '<script>alert("x")</script> & \'done\'',
        },
      ],
    };
    await runOrchestration(inputs(plan), 'token');
    const cell = stepsTable()[0][3];
    expect(cell).not.toMatch(/<script>/);
    expect(cell).toContain('&lt;script&gt;');
    expect(cell).toContain('&amp;');
    expect(cell).toContain('&quot;');
    expect(cell).toContain('&#39;');
  });

  it('escapes the other caller-supplied cells too, not just the new one', async () => {
    // step_id and service_slug are regex-constrained and cannot carry markup;
    // the owner is free text, so it is escaped along with the new column.
    const plan = {
      default_service_owner: '<b>owner</b>',
      services: [{ step_id: 'a', service_slug: 'svc', input: {} }],
    };
    await runOrchestration(inputs(plan), 'token');
    const row = stepsTable()[0];
    expect(row[0]).toBe('a');
    expect(row[2]).toBe('&lt;b&gt;owner&lt;/b&gt;');
  });

  it('writes a summary for a failed run before failing it (F2)', async () => {
    apiClient.getOrchestrationStatus.mockResolvedValue({
      execution_id: 'exec-xyz',
      status: 'failed',
      excluded_steps: 1,
      steps: [
        { step_id: 'build', status: 'failed' },
        {
          step_id: 'scan',
          status: 'excluded',
          condition: false,
          exclusion_reason: 'condition_false',
        },
        { step_id: 'ship', status: 'skipped' },
      ],
    });
    await expect(runOrchestration(inputs(conditionedPlan, true), 'token')).rejects.toThrow(
      /ended with status: failed/
    );
    // The summary exists, and it is the surface that says which step ended how.
    expect(core.__tables).toHaveLength(2);
    const rows = stepsTable();
    expect(rows[0][4]).toBe('failed');
    expect(rows[1][4]).toBe('excluded');
    expect(rows[2][4]).toBe('skipped');
    // The step statuses are still exported, and the run still fails.
    expect(core.__outputs.execution_status).toBe('failed');
    expect(core.__outputs.step_scan_status).toBe('excluded');
    expect(core.__errors.join('\n')).toMatch(/ended with status: failed/);
  });
});

describe('ZA7 — the ignored-condition warning', () => {
  it('warns once when a submitted condition is missing from the status entry', async () => {
    apiClient.getOrchestrationStatus.mockResolvedValue({
      execution_id: 'exec-xyz',
      status: 'completed',
      steps: [
        { step_id: 'build', status: 'completed' },
        { step_id: 'scan', status: 'completed' },
        { step_id: 'ship', status: 'completed' },
      ],
    });
    await runOrchestration(inputs(conditionedPlan, true), 'token');
    expect(core.__warnings).toHaveLength(1);
    expect(core.__warnings[0]).toMatch(/predates conditions/);
  });

  it('does not warn when the backend echoed the condition back', async () => {
    apiClient.getOrchestrationStatus.mockResolvedValue(conditionedStatus);
    await runOrchestration(inputs(conditionedPlan, true), 'token');
    expect(core.__warnings).toHaveLength(0);
  });

  it('does not warn over a cascade-excluded step, whose condition is null (ZQ3)', async () => {
    const plan = {
      default_service_owner: 'o',
      services: [
        { step_id: 'build', service_slug: 'svc', input: {} },
        { step_id: 'ship', service_slug: 'svc', input: {}, depends_on: ['build'] },
      ],
    };
    apiClient.getOrchestrationStatus.mockResolvedValue({
      execution_id: 'exec-xyz',
      status: 'completed',
      excluded_steps: 1,
      steps: [
        { step_id: 'build', status: 'completed' },
        {
          step_id: 'ship',
          status: 'excluded',
          condition: null,
          exclusion_reason: 'dependency_excluded',
          excluded_by: 'build',
        },
      ],
    });
    await runOrchestration(inputs(plan, true), 'token');
    expect(core.__warnings).toHaveLength(0);
  });

  it('does not warn on a plan with no conditions at all', async () => {
    const plan = {
      default_service_owner: 'o',
      services: [{ step_id: 'build', service_slug: 'svc', input: {} }],
    };
    apiClient.getOrchestrationStatus.mockResolvedValue({
      execution_id: 'exec-xyz',
      status: 'completed',
      steps: [{ step_id: 'build', status: 'completed' }],
    });
    await runOrchestration(inputs(plan, true), 'token');
    expect(core.__warnings).toHaveLength(0);
  });
});

describe('ZA8 — the quoted-condition hint', () => {
  const plan = {
    default_service_owner: 'o',
    services: [{ step_id: 'a', service_slug: 'svc', input: {}, condition: 'false' }],
  };

  it("appends the hint to Core's invalid-condition 400 when the value was a string", async () => {
    apiClient.submitOrchestration.mockRejectedValue(
      new Error(
        "Failed to submit orchestration (HTTP 400): Step 'a' has an invalid condition: expected true or false, got a string"
      )
    );
    const err = await runOrchestration(inputs(plan), 'token').catch((e: Error) => e);
    expect((err as Error).message).toContain("Step 'a' has an invalid condition");
    expect((err as Error).message).toContain('Remove the quotes around the expression.');
  });

  it('does not append the hint when the submitted condition was a boolean', async () => {
    apiClient.submitOrchestration.mockRejectedValue(
      new Error("Failed to submit orchestration (HTTP 400): Step 'scan' has an invalid condition")
    );
    const err = await runOrchestration(inputs(conditionedPlan), 'token').catch((e: Error) => e);
    expect((err as Error).message).not.toContain('Remove the quotes');
  });

  it('leaves an unrelated 400 untouched', async () => {
    apiClient.submitOrchestration.mockRejectedValue(
      new Error('Failed to submit orchestration (HTTP 400): service not found')
    );
    const err = await runOrchestration(inputs(plan), 'token').catch((e: Error) => e);
    expect((err as Error).message).toBe(
      'Failed to submit orchestration (HTTP 400): service not found'
    );
  });
});
