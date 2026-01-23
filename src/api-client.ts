import { HttpClient } from '@actions/http-client';
import { EventRequest, EventResponse } from './types';

/**
 * Send event to Zekt backend
 */
export async function sendEvent(
  apiUrl: string,
  oidcToken: string,
  eventRequest: EventRequest
): Promise<EventResponse> {
  const client = new HttpClient('zekt-action/2.0.2');
  const endpoint = `${apiUrl}/api/events/receive`;

  const response = await client.postJson<EventResponse>(endpoint, eventRequest, {
    'authorization': `Bearer ${oidcToken}`,
    'content-type': 'application/json',
    'x-github-repository': eventRequest.repository,
  });

  if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
    const errorMsg = response.result?.error || 'Unknown error';
    throw new Error(`Failed to send event (HTTP ${response.statusCode}): ${errorMsg}`);
  }

  if (!response.result) {
    throw new Error('Invalid response from Zekt API: empty response');
  }

  return response.result;
}
