import * as fs from 'fs';
import * as path from 'path';

import { TERMINAL_STATUSES } from '../src/terminal-statuses';

// The fixture is a byte-identical copy of zektMainWeb's
// backend/api/CustomerApi.Tests/Contracts/orchestration-terminal-statuses.json, which a Core test checks against
// OrchestrationService.IsExecutionTerminal. Update both copies together.
const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'orchestration-terminal-statuses.json'), 'utf-8')
) as { terminal: string[] };

describe('terminal statuses', () => {
  it('stops polling on exactly the statuses Core treats as terminal', () => {
    expect([...TERMINAL_STATUSES].sort()).toEqual([...fixture.terminal].sort());
  });

  it('treats a cancelled orchestration as finished', () => {
    expect(TERMINAL_STATUSES.has('cancelled')).toBe(true);
  });
});
