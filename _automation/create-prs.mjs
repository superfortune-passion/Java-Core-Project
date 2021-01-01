import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
import { getManifestPath, loadConfig } from './lib/config.mjs';

async function getGitHubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;

  try {
    return execSync('gh auth token', { encoding: 'utf8', stdio: 'pipe' }).trim();
  } catch {
    // fall through
  }

  const result = spawnSync(
    'git',
    ['credential', 'fill'],
    {
      input: 'protocol=https\nhost=github.com\n\n',
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  const match = result.stdout.match(/^password=(.+)$/m);
  if (match?.[1]) return match[1].trim();
  return null;
}

async function createPullRequest(token, owner, repo, branch, base, title, body) {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'java-core-projects-automation',
    },
    body: JSON.stringify({
      title,
      head: branch,
      base,
      body,
      maintainer_can_modify: true,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    if (data.errors?.some((error) => /already exists/i.test(error.message))) {
      return findExistingPullRequest(token, owner, repo, branch, base);
    }
    throw new Error(`Failed to create PR for ${branch}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function findExistingPullRequest(token, owner, repo, branch, base) {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls?state=open&head=${owner}:${branch}&base=${base}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'java-core-projects-automation',
      },
    },
  );
  const data = await response.json();
  if (Array.isArray(data) && data.length > 0) return data[0];
  return null;
}

function branchTitle(branch) {
  return branch
    .replace(/^feat\//, '')
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

async function main() {
  const config = loadConfig();
  const manifest = JSON.parse(fs.readFileSync(getManifestPath(), 'utf8'));
  const token = await getGitHubToken();

  if (!token) {
    throw new Error('No GitHub token found. Set GITHUB_TOKEN or authenticate gh/git credentials.');
  }

  const results = [];
  for (const branch of manifest.mergeOrder) {
    const commitCount = manifest.commits.filter((entry) => entry.branch === branch).length;
    const title = `feat: ${branchTitle(branch)}`;
    const body = [
      '## Summary',
      `- Adds ${commitCount} commits from \`${branch}\` for ${config.year} history automation.`,
      '- Please merge manually on GitHub.',
      '',
      '## Merge note',
      'Merge in the order listed by the automation report to preserve logical project progression.',
    ].join('\n');

    console.log(`Creating PR for ${branch}...`);
    const pr = await createPullRequest(
      token,
      config.repoOwner,
      config.repoName,
      branch,
      config.defaultBranch,
      title,
      body,
    );
    results.push({
      branch,
      number: pr.number,
      url: pr.html_url,
      title: pr.title,
    });
    console.log(`  -> ${pr.html_url}`);
  }

  const reportPath = '_automation/pr-report.json';
  fs.writeFileSync(reportPath, JSON.stringify({ createdAt: new Date().toISOString(), results }, null, 2));
  console.log(`Saved PR report to ${reportPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
