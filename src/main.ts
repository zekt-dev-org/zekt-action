import * as core from '@actions/core';
import * as github from '@actions/github';
import { getActionInputs, readOrchestrationStepRef } from './utils';
import { getConsumerKeys, encryptPayload } from './shield';
import { sendEvent } from './api-client';
import { runOrchestration } from './orchestrate';
import { ActionInputs, EventRequest, ShieldEnvelope, EventResponse } from './types';

export async function run(): Promise<void> {
  try {
    // 1. Get inputs
    const inputs = getActionInputs();
    core.info(`Orchestrate: ${inputs.orchestrate}`);

    // 2. Get OIDC token (used by both paths)
    const oidcToken = await core.getIDToken('api://zekt');
    core.setSecret(oidcToken);
    core.info('✅ OIDC token obtained');

    // ── Orchestration path ──────────────────────────────────────────────────
    if (inputs.orchestrate) {
      await runOrchestration(inputs, oidcToken);
      return;
    }

    // ── Standard (v2) path ──────────────────────────────────────────────────
    // Auto-detect orchestration context early — provider workflows reporting
    // step outputs don't need event-type when _zekt context is present.
    const orchestrationStepRef = readOrchestrationStepRef();
    if (orchestrationStepRef) {
      core.info(`🔗 Orchestration context detected — execution_id: ${orchestrationStepRef.execution_id}, step_id: ${orchestrationStepRef.step_id}`);
    }

    if (!inputs.eventType && !orchestrationStepRef) {
      throw new Error('"event-type" input is required when orchestrate is false and not in orchestration context');
    }

    if (inputs.eventType) {
      core.info(`Event Type: ${inputs.eventType}`);
    }
    core.info(`Shield: ${inputs.shield}`);

    // 3. Parse payload
    let payloadObject: unknown;
    try {
      payloadObject = JSON.parse(inputs.payload);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Invalid JSON payload: ${errorMessage}`);
    }

    // 4. Shield encryption (if enabled)
    let finalPayload: unknown | ShieldEnvelope = payloadObject;

    if (inputs.shield) {
      core.info('🛡️ Shield encryption enabled');

      // Get consumer keys
      const consumerKeys = await getConsumerKeys(
        inputs.zektApiUrl,
        oidcToken,
        github.context.repo.owner + '/' + github.context.repo.repo
      );

      core.info(`📋 Retrieved ${consumerKeys.length} consumer keys`);

      if (consumerKeys.length === 0) {
        throw new Error(
          'Shield encryption requested but no consumers have uploaded a public key. ' +
          'Upload consumer public keys in the Zekt dashboard (Settings > Shield/Consumer Keys) before enabling Shield.'
        );
      }

      finalPayload = await encryptPayload(payloadObject, consumerKeys);
      core.info('✅ Payload encrypted successfully');
    }

    // 5. Build event request
    const eventRequest: EventRequest = {
      eventType: inputs.eventType || 'orchestration-step-output',
      repository: github.context.repo.owner + '/' + github.context.repo.repo,
      workflowRunId: github.context.runId.toString(),
      triggeredBy: github.context.actor,
      commitSha: github.context.sha,
      ref: github.context.ref,
      workflow: github.context.workflow,
      payload: finalPayload,
      timestamp: new Date().toISOString(),
      // omit key entirely when null so existing backend ignores the absence
      ...(orchestrationStepRef && { orchestration_step_ref: orchestrationStepRef }),
    };

    // 6. Send to Zekt
    const response = await sendEvent(inputs.zektApiUrl, oidcToken, eventRequest);

    // 7. Set outputs
    core.setOutput('event-id', response.eventId || '');
    core.setOutput('status', response.success ? 'success' : 'failed');
    core.setOutput('consumers-notified', response.consumersNotified || 0);

    // 8. Write job summary
    await writeJobSummary(inputs, response, inputs.shield);

    core.info('✅ Event sent successfully');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    core.error(`❌ Failed: ${errorMessage}`);
    throw error;
  }
}

async function writeJobSummary(
  inputs: ActionInputs,
  response: EventResponse,
  shieldEnabled: boolean
): Promise<void> {
  await core.summary
    .addHeading('Zekt Event Delivery')
    .addTable([
      [
        { data: 'Property', header: true },
        { data: 'Value', header: true },
      ],
      ['Event Type', inputs.eventType],
      [
        'Repository',
        github.context.repo.owner + '/' + github.context.repo.repo,
      ],
      ['Workflow', github.context.workflow],
      ['Run ID', github.context.runId.toString()],
      ['Shield', shieldEnabled ? '🛡️ Enabled' : 'Disabled'],
      ['Status', response.success ? '✅ Success' : '❌ Failed'],
      ['Event ID', response.eventId || 'N/A'],
      ['Consumers Notified', (response.consumersNotified || 0).toString()],
    ])
    .addRaw('<hr>')
    .addRaw(
      '_Sent via [Zekt Action](https://github.com/zekt-dev-org/zekt-action)_'
    )
    .write();
}
