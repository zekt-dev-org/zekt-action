import * as core from '@actions/core';
import * as github from '@actions/github';
import { getActionInputs } from './utils';
import { getConsumerKeys, encryptPayload } from './shield';
import { sendEvent } from './api-client';
import { ActionInputs, EventRequest, ShieldEnvelope, EventResponse } from './types';

export async function run(): Promise<void> {
  try {
    // 1. Get inputs
    const inputs = getActionInputs();
    core.info(`Event Type: ${inputs.eventType}`);
    core.info(`Shield: ${inputs.shield}`);

    // 2. Get OIDC token
    const oidcToken = await core.getIDToken('api://zekt');
    core.setSecret(oidcToken);
    core.info('✅ OIDC token obtained');

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
        core.warning('⚠️ No consumers have uploaded Shield public keys');
        core.warning('   Consumers must upload public keys in Zekt dashboard: Settings > Shield/Consumer Keys');
        core.warning('   Payload will be sent UNENCRYPTED');
        core.warning('   If service requires Shield, backend will reject this payload');
        
        // Continue without encryption - backend will enforce if needed
        // finalPayload remains as payloadObject (unencrypted)
      } else {
        // Encrypt payload
        finalPayload = await encryptPayload(payloadObject, consumerKeys);
        core.info('✅ Payload encrypted successfully');
      }
    }

    // 5. Build event request
    const eventRequest: EventRequest = {
      eventType: inputs.eventType,
      repository: github.context.repo.owner + '/' + github.context.repo.repo,
      workflowRunId: github.context.runId.toString(),
      triggeredBy: github.context.actor,
      commitSha: github.context.sha,
      ref: github.context.ref,
      workflow: github.context.workflow,
      payload: finalPayload,
      timestamp: new Date().toISOString(),
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
