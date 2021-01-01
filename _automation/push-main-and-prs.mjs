import { spawnSync } from 'child_process';
import fs from 'fs';
import { getRoot, getManifestPath, loadConfig } from './lib/config.mjs';
import { listRemoteBranches, runGit, runGitCapture } from './lib/git.mjs';

function runValidation() {
  const result = spawnSync(process.execPath, ['_automation/validate-history.mjs'], {
    cwd: getRoot(),
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error('Validation failed; aborting push');
  }
}

function branchCommitsSince(baseRef, branch) {
  const out = runGitCapture(['log', '--reverse', '--format=%H', `${baseRef}..${branch}`]);
  return out ? out.split('\n').filter(Boolean) : [];
}

function cherryPickOntoMain(mainDirectBranches, baseRef) {
  runGit(['checkout', 'main']);
  for (const branch of mainDirectBranches) {
    const commits = branchCommitsSince(baseRef, branch);
    console.log(`Integrating ${commits.length} commits from ${branch} onto main...`);
    for (const hash of commits) {
      runGit(['cherry-pick', hash]);
    }
  }
}

function rebuildPrBranch(branch, baseRef, branchTip) {
  const commits = runGitCapture(['log', '--reverse', '--format=%H', `${baseRef}..${branchTip}`])
    .split('\n')
    .filter(Boolean);
  runGit(['checkout', '-B', branch, 'main']);
  for (const hash of commits) {
    runGit(['cherry-pick', hash]);
  }
}

function countTodayCommits(config) {
  const out = runGitCapture(['log', '--all', '--format=%aI']);
  if (!out) return 0;
  return out.split('\n').filter((line) => line.startsWith(config.todayDate)).length;
}

function main() {
  const config = loadConfig();
  const manifest = JSON.parse(fs.readFileSync(getManifestPath(), 'utf8'));
  const prBranches = config.prBranches.filter((branch) => manifest.mergeOrder.includes(branch));
  const mainDirectBranches = manifest.mergeOrder.filter((branch) => !prBranches.includes(branch));

  if (prBranches.length !== 3) {
    throw new Error(`Expected exactly 3 PR branches, found ${prBranches.length}`);
  }

  console.log('Running validation before push...');
  runValidation();

  const baseRef = runGitCapture(['rev-parse', 'main']);
  const branchTips = {};
  for (const branch of manifest.mergeOrder) {
    branchTips[branch] = runGitCapture(['rev-parse', branch]);
  }

  cherryPickOntoMain(mainDirectBranches, baseRef);

  const todayCount = countTodayCommits(config);
  if (todayCount > config.maxTodayCommits) {
    throw new Error(`Today (${config.todayDate}) has ${todayCount} commits; max ${config.maxTodayCommits}`);
  }

  const remoteBranches = listRemoteBranches(config.remote);
  for (const remoteBranch of remoteBranches) {
    if (remoteBranch.startsWith('feat/') || remoteBranch === config.defaultBranch) {
      console.log(`Deleting stale remote branch ${remoteBranch}...`);
      runGit(['push', config.remote, '--delete', remoteBranch], { allowFail: true });
    }
  }

  console.log(`Pushing ${config.defaultBranch} with ${mainDirectBranches.length} integrated feature groups...`);
  runGit(['push', '--force', config.remote, `${config.defaultBranch}:${config.defaultBranch}`]);

  for (const branch of prBranches) {
    rebuildPrBranch(branch, baseRef, branchTips[branch]);
    console.log(`Pushing PR branch ${branch}...`);
    runGit(['push', '--force', config.remote, `${branch}:${branch}`]);
  }

  const mainCount = runGitCapture(['rev-list', '--count', 'main']);
  console.log(JSON.stringify({
    mainCommits: Number(mainCount),
    mainDirectGroups: mainDirectBranches.length,
    prBranches,
    todayCommits: todayCount,
  }, null, 2));
}

main();
