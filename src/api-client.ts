import { HttpClient } from '@actions/http-client';
import {
  EventRequest,
  EventResponse,
  SubmitOrchestrationRequest,
  SubmitOrchestrationResponse,
  OrchestrationStatusResponse,
} from './types';

function makeClient(): HttpClient {
  return new HttpClient('zekt-action/3.0.0');
}

function authHeaders(oidcToken: string, repository: string): Record<string, string> {
  return {
    authorization: `Bearer ${oidcToken}`,
    'content-type': 'application/json',
    'x-github-repository': repository,
  };
}

/**
 * Send event to Zekt backend
 */
export async function sendEvent(
  apiUrl: string,
  oidcToken: string,
  eventRequest: EventRequest
): Promise<EventResponse> {
  const client = makeClient();
  const endpoint = `${apiUrl}/api/events/receive`;

  const response = await client.postJson<EventResponse>(
    endpoint,
    eventRequest,
    authHeaders(oidcToken, eventRequest.repository)
  );

  if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
    const errorMsg = response.result?.error || 'Unknown error';
    throw new Error(`Failed to send event (HTTP ${response.statusCode}): ${errorMsg}`);
  }

  if (!response.result) {
    throw new Error('Invalid response from Zekt API: empty response');
  }

  return response.result;
}

/**
 * Submit an orchestration plan to Zekt backend
 */
export async function submitOrchestration(
  apiUrl: string,
  oidcToken: string,
  repository: string,
  request: SubmitOrchestrationRequest
): Promise<SubmitOrchestrationResponse> {
  const client = makeClient();
  const endpoint = `${apiUrl}/api/orchestration/submit`;

  const response = await client.postJson<SubmitOrchestrationResponse>(
    endpoint,
    request,
    authHeaders(oidcToken, repository)
  );

  if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
    const errorMsg =
      (response.result as unknown as { error?: string })?.error || 'Unknown error';
    throw new Error(
      `Failed to submit orchestration (HTTP ${response.statusCode}): ${errorMsg}`
    );
  }

  if (!response.result?.execution_id) {
    throw new Error('Invalid response from Zekt API: missing execution_id');
  }

  return response.result;
}

/**
 * Poll orchestration status until a terminal state is reached
 */
export async function getOrchestrationStatus(
  apiUrl: string,
  oidcToken: string,
  repository: string,
  executionId: string
): Promise<OrchestrationStatusResponse> {
  const client = makeClient();
  const endpoint = `${apiUrl}/api/orchestration/${encodeURIComponent(executionId)}/status`;

  const response = await client.getJson<OrchestrationStatusResponse>(
    endpoint,
    authHeaders(oidcToken, repository)
  );

  if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`Failed to get orchestration status (HTTP ${response.statusCode})`);
  }

  if (!response.result) {
    throw new Error('Invalid response from Zekt API: empty status response');
  }

  return response.result;
}
