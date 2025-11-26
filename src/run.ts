/**
 * Main action logic for Zekt Action
 */

import * as core from '@actions/core';
import * as github from '@actions/github';
import { validateInputs, validatePayloadSize, validateJSON } from './validator';
import { sendToZekt } from './api-client';
import { ActionInputs, RegisterRunRequest, GitHubContext } from './types';
import { formatBytes } from './utils';

export async function run(): Promise<void> {
  try {
    // 1. Read inputs (no zektApiUrl needed - loaded from config)
    const inputs: ActionInputs = {
      zektRunId: parseInt(core.getInput('zekt_run_id', { required: true })),
      zektStepId: core.getInput('zekt_step_id') || 'default',
      zektPayload: core.getInput('zekt_payload', { required: true }),
      githubToken: core.getInput('github_token', { required: true }),
    };

    // 2. Validate inputs
    core.info('Validating inputs...');
    validateInputs(inputs);

    // 3. Validate payload size (with warning at 80% threshold)
    core.info('Validating payload size...');
    const sizeValidation = validatePayloadSize(inputs.zektPayload);
    core.info(`Payload size: ${formatBytes(sizeValidation.sizeBytes)}`);

    // 4. Validate JSON structure
    core.info('Validating JSON structure...');
    const parsedPayload = validateJSON(inputs.zektPayload);

    // 5. Construct GitHub context
    const githubContext: GitHubContext = {
      repository: `${github.context.repo.owner}/${github.context.repo.repo}`,
      workflow: github.context.workflow,
      job: github.context.job,
      actor: github.context.actor,
      event_name: github.context.eventName,
      ref: github.context.ref,
      sha: github.context.sha,
    };

    // 6. Construct request payload
    const request: RegisterRunRequest = {
      zekt_run_id: inputs.zektRunId,
      zekt_step_id: inputs.zektStepId,
      zekt_payload: parsedPayload,
      github_context: githubContext,
    };

    // 7. Send to Zekt backend (API URL loaded from config/environment)
    core.info(
      `Sending payload to Zekt (run_id: ${inputs.zektRunId}, step_id: ${inputs.zektStepId})...`
    );
    const response = await sendToZekt(request, inputs.githubToken);

    // 8. Set outputs
    core.setOutput('success', 'true');
    core.setOutput('run_id', inputs.zektRunId.toString());
    core.setOutput('step_id', inputs.zektStepId);
    core.setOutput('error_message', '');

    core.info(`✅ Successfully registered run ${inputs.zektRunId} with Zekt`);
    core.info(`Message: ${response.message || 'Payload registered successfully'}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

    core.setOutput('success', 'false');
    core.setOutput('error_message', errorMessage);

    core.setFailed(`❌ Failed to register run with Zekt: ${errorMessage}`);
  }
}
