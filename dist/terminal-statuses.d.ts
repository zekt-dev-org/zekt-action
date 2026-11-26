/**
 * The orchestration execution statuses that end a `wait: true` poll: every status Core treats as terminal.
 *
 * Core's set is the contract fixture `__tests__/fixtures/orchestration-terminal-statuses.json`, a byte-identical copy
 * of zektMainWeb's `backend/api/CustomerApi.Tests/Contracts/orchestration-terminal-statuses.json`, and
 * `__tests__/terminal-statuses.test.ts` keeps this set equal to it. The poll has no bound of its own, so a terminal
 * status missing here keeps a run polling until GitHub's job timeout, on the customer's minutes.
 */
export declare const TERMINAL_STATUSES: ReadonlySet<string>;
