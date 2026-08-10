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

/** Extracts the most useful error string from a raw response body (JSON or HTML/text). */
function extractErrorMessage(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return '(empty response body)';
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const msg = parsed['error'] ?? parsed['message'] ?? parsed['title'] ?? parsed['detail'];
    if (typeof msg === 'string' && msg.trim()) return msg.trim();
  } catch {
    // not JSON — strip HTML tags and collapse whitespace
    return trimmed.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 400);
  }
  return trimmed.slice(0, 400);
}

export async function sendEvent(
  apiUrl: string,
  oidcToken: string,
  eventRequest: EventRequest
): Promise<EventResponse> {
  const client = makeClient();
  const res = await client.post(
    `${apiUrl}/api/events/receive`,
    JSON.stringify(eventRequest),
    authHeaders(oidcToken, eventRequest.repository)
  );
  const statusCode = res.message.statusCode ?? 0;
  const body = await res.readBody();
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`Failed to send event (HTTP ${statusCode}): ${extractErrorMessage(body)}`);
  }
  try {
    return JSON.parse(body) as EventResponse;
  } catch {
    throw new Error(`Invalid response from Zekt API (events/receive): ${body.trim().slice(0, 200)}`);
  }
}

export async function submitOrchestration(
  apiUrl: string,
  oidcToken: string,
  repository: string,
  request: SubmitOrchestrationRequest
): Promise<SubmitOrchestrationResponse> {
  const client = makeClient();
  const res = await client.post(
    `${apiUrl}/api/orchestration/submit`,
    JSON.stringify(request),
    authHeaders(oidcToken, repository)
  );
  const statusCode = res.message.statusCode ?? 0;
  const body = await res.readBody();
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`Failed to submit orchestration (HTTP ${statusCode}): ${extractErrorMessage(body)}`);
  }
  let result: SubmitOrchestrationResponse;
  try {
    result = JSON.parse(body) as SubmitOrchestrationResponse;
  } catch {
    throw new Error(`Invalid response from Zekt API (orchestration/submit): ${body.trim().slice(0, 200)}`);
  }
  if (!result.execution_id) {
    throw new Error('Invalid response from Zekt API: missing execution_id');
  }
  return result;
}

export async function getOrchestrationStatus(
  apiUrl: string,
  oidcToken: string,
  repository: string,
  executionId: string
): Promise<OrchestrationStatusResponse> {
  const client = makeClient();
  const res = await client.get(
    `${apiUrl}/api/orchestration/${encodeURIComponent(executionId)}/status`,
    authHeaders(oidcToken, repository)
  );
  const statusCode = res.message.statusCode ?? 0;
  const body = await res.readBody();
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error(`Failed to get orchestration status (HTTP ${statusCode}): ${extractErrorMessage(body)}`);
  }
  try {
    return JSON.parse(body) as OrchestrationStatusResponse;
  } catch {
    throw new Error(`Invalid response from Zekt API (orchestration/status): ${body.trim().slice(0, 200)}`);
  }
}
