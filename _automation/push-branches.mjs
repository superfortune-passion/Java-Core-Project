import { spawnSync } from 'child_process';
import fs from 'fs';
import { getRoot, getManifestPath, loadConfig } from './lib/config.mjs';
import { listRemoteBranches, runGit } from './lib/git.mjs';

function runValidation() {
  const result = spawnSync(process.execPath, ['_automation/validate-history.mjs'], {
    cwd: getRoot(),
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error('Validation failed; aborting push');
  }
}

function main() {
  const config = loadConfig();
  const manifest = JSON.parse(fs.readFileSync(getManifestPath(), 'utf8'));

  console.log('Running validation before push...');
  runValidation();

  const remoteBranches = listRemoteBranches(config.remote);
  const localFeatureBranches = manifest.mergeOrder;

  for (const remoteBranch of remoteBranches) {
    if (localFeatureBranches.includes(remoteBranch)) {
      console.log(`Deleting stale remote branch ${remoteBranch}...`);
      runGit(['push', config.remote, '--delete', remoteBranch], { allowFail: true });
    }
  }

  console.log(`Pushing ${config.defaultBranch} (base commit only)...`);
  runGit(['push', '--force', config.remote, `${config.defaultBranch}:${config.defaultBranch}`]);

  for (const branch of manifest.mergeOrder) {
    console.log(`Pushing ${branch}...`);
    runGit(['push', '--force', config.remote, `${branch}:${branch}`]);
  }

  console.log('All feature branches pushed.');
}

main();
