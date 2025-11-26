/**
 * Entry point for Zekt Action
 */

import { run } from './run';

// Execute action
run().catch((error) => {
  console.error('Unhandled error in Zekt Action:', error);
  process.exit(1);
});
