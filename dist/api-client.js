"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEvent = sendEvent;
const http_client_1 = require("@actions/http-client");
/**
 * Send event to Zekt backend
 */
async function sendEvent(apiUrl, oidcToken, eventRequest) {
    const client = new http_client_1.HttpClient('zekt-action/2.0.2');
    const endpoint = `${apiUrl}/api/events/receive`;
    const response = await client.postJson(endpoint, eventRequest, {
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
//# sourceMappingURL=api-client.js.map