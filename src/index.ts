import * as core from '@actions/core';
import { run } from './main';

// Entry point - catches all errors
run().catch((error) => {
  core.setFailed(error.message);
  process.exit(1);
});
