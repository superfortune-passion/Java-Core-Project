import fs from 'fs';
import path from 'path';
import {
  getRoot,
  getSnapshotDir,
  getManifestPath,
  loadConfig,
} from './lib/config.mjs';
import {
  clearProjectFiles,
  commitMessage,
  discoverFiles,
  copyFileFromSnapshot,
  groupFilesByBranch,
  restoreFromSnapshot,
  snapshotProject,
} from './lib/files.mjs';
import {
  commitAt,
  deleteGitDir,
  getRemoteUrl,
  initRepository,
  runGit,
  setRemote,
} from './lib/git.mjs';
import { buildSchedule, summarizeSchedule } from './lib/schedule.mjs';

const ROOT = getRoot();
const GITIGNORE = `# Build artifacts
.gradle/
build/
*.class

# IDE
.idea/

# Automation internals
_automation/.snapshot/
_automation/.work/
_automation/manifest.json
`;

function writeGitignore() {
  fs.writeFileSync(path.join(ROOT, '.gitignore'), GITIGNORE);
}

function buildManifest(files, groups, schedule, mergeOrder) {
  const branchEntries = mergeOrder
    .filter((branch) => groups.has(branch))
    .map((branch) => ({
      branch,
      files: groups.get(branch),
    }));

  let scheduleIndex = 0;
  const commits = [];
  for (const entry of branchEntries) {
    for (const file of entry.files) {
      commits.push({
        branch: entry.branch,
        file,
        message: commitMessage(file),
        date: schedule[scheduleIndex].iso,
        dateKey: schedule[scheduleIndex].dateKey,
      });
      scheduleIndex++;
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    year: loadConfig().year,
    author: {
      name: loadConfig().authorName,
      email: loadConfig().authorEmail,
    },
    defaultBranch: loadConfig().defaultBranch,
    mergeOrder: branchEntries.map((entry) => entry.branch),
    commits,
    scheduleSummary: summarizeSchedule(schedule),
  };
}

function createInitialCommit(config) {
  writeGitignore();
  const date = `${config.year}-01-01T10:00:00Z`;
  commitAt(date, 'feat: .gitignore add repository ignore rules');
}

function createFeatureBranches(manifest) {
  const snapshotDir = getSnapshotDir();
  for (const branch of manifest.mergeOrder) {
    runGit(['checkout', manifest.defaultBranch]);
    runGit(['branch', '-D', branch], { allowFail: true });
    runGit(['checkout', '-b', branch]);

    const branchCommits = manifest.commits.filter((entry) => entry.branch === branch);
    for (const entry of branchCommits) {
      copyFileFromSnapshot(snapshotDir, ROOT, entry.file);
      commitAt(entry.date, entry.message);
    }
  }
}

function main() {
  const config = loadConfig();
  const snapshotDir = getSnapshotDir();
  const previousRemote = getRemoteUrl(config.remote);

  console.log('Discovering project files...');
  const files = discoverFiles(ROOT);
  const groups = groupFilesByBranch(files, config.branchMap);
  const mergeOrder = config.mergeOrder.filter((branch) => groups.has(branch));
  const extraBranches = [...groups.keys()].filter((branch) => !mergeOrder.includes(branch));
  const orderedBranches = [...mergeOrder, ...extraBranches];

  console.log(`Found ${files.length} files across ${groups.size} feature groups`);

  if (files.length === 0) {
    throw new Error('No project files discovered. Aborting to avoid wiping the working tree.');
  }

  if (files.length > config.maxTotalCommits) {
    throw new Error(
      `File count ${files.length} exceeds push safety cap of ${config.maxTotalCommits} commits`,
    );
  }

  console.log('Creating snapshot...');
  snapshotProject(ROOT, snapshotDir, files);

  console.log('Rebuilding git history (deleting .git)...');
  deleteGitDir(ROOT);
  clearProjectFiles(ROOT, files);
  initRepository(config.defaultBranch);

  if (previousRemote) {
    setRemote(config.remote, previousRemote);
  }

  const schedule = buildSchedule(files.length, config);
  const scheduleStats = summarizeSchedule(schedule);
  console.log(
    `Scheduled ${scheduleStats.total} commits across ${scheduleStats.activeDays} active days (max/day=${scheduleStats.maxDay})`,
  );

  createInitialCommit(config);
  const manifest = buildManifest(files, groups, schedule, orderedBranches);
  manifest.initialCommit = {
    branch: config.defaultBranch,
    message: 'feat: .gitignore add repository ignore rules',
    date: `${config.year}-01-01T10:00:00Z`,
  };
  fs.mkdirSync(path.dirname(getManifestPath()), { recursive: true });
  fs.writeFileSync(getManifestPath(), JSON.stringify(manifest, null, 2));

  createFeatureBranches(manifest);

  console.log('Restoring full working tree from snapshot...');
  restoreFromSnapshot(snapshotDir, ROOT, files);
  runGit(['checkout', config.defaultBranch]);

  console.log('Generation complete.');
  console.log(JSON.stringify({
    totalFeatureCommits: manifest.commits.length,
    activeDays: manifest.scheduleSummary.activeDays,
    maxDay: manifest.scheduleSummary.maxDay,
    branches: manifest.mergeOrder,
  }, null, 2));
}

main();
