import { spawnSync } from 'child_process';
import { getRoot } from './lib/config.mjs';

const steps = [
  ['push-branches.mjs', 'Pushing feature branches'],
  ['create-prs.mjs', 'Creating pull requests'],
];

for (const [script, label] of steps) {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(process.execPath, [`_automation/${script}`], {
    cwd: getRoot(),
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    console.error(`Step failed: ${script}`);
    process.exit(result.status || 1);
  }
}

console.log('\nPush and PR creation complete.');
