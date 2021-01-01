import { getManifestPath, loadConfig } from './lib/config.mjs';
import { listCommits } from './lib/git.mjs';
import fs from 'fs';

function parseYear(dateIso) {
  return dateIso.slice(0, 4);
}

function dateKey(dateIso) {
  return dateIso.slice(0, 10);
}

function validate(manifest, config) {
  const errors = [];
  const warnings = [];
  const featureCommits = manifest.commits || [];
  const allCommits = listCommits('--all');

  const yearCommits = allCommits.filter(
    (commit) =>
      parseYear(commit.authorDate) === String(config.year) &&
      parseYear(commit.committerDate) === String(config.year),
  );

  const totalInYear = yearCommits.length;
  const totalFeature = featureCommits.length;

  if (totalFeature > config.maxTotalCommits) {
    errors.push(`Feature commit count ${totalFeature} exceeds push cap ${config.maxTotalCommits}`);
  }
  if (totalInYear > config.maxCommitsInRange) {
    errors.push(`Year commit count ${totalInYear} exceeds range cap ${config.maxCommitsInRange}`);
  }

  const perDay = new Map();
  const firstOfMonth = new Map();
  for (const commit of yearCommits) {
    const key = dateKey(commit.authorDate);
    perDay.set(key, (perDay.get(key) || 0) + 1);
    if (key.endsWith('-01')) {
      const month = key.slice(0, 7);
      firstOfMonth.set(month, (firstOfMonth.get(month) || 0) + 1);
    }
    if (commit.authorDate !== commit.committerDate) {
      errors.push(`Author/committer date mismatch on ${commit.hash}: ${commit.subject}`);
    }
    if (commit.authorName !== config.authorName || commit.authorEmail !== config.authorEmail) {
      errors.push(`Unexpected author on ${commit.hash}: ${commit.authorName} <${commit.authorEmail}>`);
    }
  }

  const todayKey = config.todayDate;
  const todayCount = allCommits.filter(
    (commit) => dateKey(commit.authorDate) === todayKey || dateKey(commit.committerDate) === todayKey,
  ).length;
  if (todayCount > config.maxTodayCommits) {
    errors.push(`Today (${todayKey}) has ${todayCount} commits; max allowed ${config.maxTodayCommits}`);
  }

  let maxDay = 0;
  for (const [day, count] of perDay.entries()) {
    maxDay = Math.max(maxDay, count);
    const isFirst = day.endsWith('-01');
    const cap = isFirst ? config.maxFirstOfMonth : config.maxPerDay;
    if (count > cap) {
      errors.push(`Day ${day} has ${count} commits; cap is ${cap}`);
    }
  }

  for (const [month, count] of firstOfMonth.entries()) {
    if (count > config.maxFirstOfMonth) {
      errors.push(`First-of-month ${month}-01 has ${count} commits; cap is ${config.maxFirstOfMonth}`);
    }
  }

  const aiPatterns = [/cursor/i, /copilot/i, /openai/i, /github-actions/i, /dependabot/i];
  for (const commit of allCommits) {
    for (const pattern of aiPatterns) {
      if (pattern.test(commit.authorName) || pattern.test(commit.authorEmail)) {
        errors.push(`Disallowed contributor detected: ${commit.authorName} <${commit.authorEmail}>`);
      }
    }
  }

  const mainCommits = listCommits(config.defaultBranch);
  if (mainCommits.length !== 1) {
    errors.push(`Expected exactly 1 commit on ${config.defaultBranch}, found ${mainCommits.length}`);
  }

  const stats = {
    totalInYear,
    totalFeature,
    maxDay,
    activeDays: perDay.size,
    todayCount,
    branches: manifest.mergeOrder?.length || 0,
  };

  return { errors, warnings, stats };
}

function main() {
  const config = loadConfig();
  const manifestPath = getManifestPath();
  if (!fs.existsSync(manifestPath)) {
    throw new Error('manifest.json not found. Run generate-history.mjs first.');
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const { errors, warnings, stats } = validate(manifest, config);

  if (warnings.length) {
    console.warn('Warnings:');
    for (const warning of warnings) console.warn(`  - ${warning}`);
  }

  if (errors.length) {
    console.error('Validation FAILED:');
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }

  console.log('Validation PASSED');
  console.log(JSON.stringify(stats, null, 2));
}

main();
