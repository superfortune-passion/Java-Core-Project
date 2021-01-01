import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { getRoot, loadConfig } from './config.mjs';

export function runGit(args, options = {}) {
  const root = options.cwd || getRoot();
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: options.authorName,
    GIT_AUTHOR_EMAIL: options.authorEmail,
    GIT_COMMITTER_NAME: options.authorName,
    GIT_COMMITTER_EMAIL: options.authorEmail,
  };
  const result = spawnSync('git', args, {
    cwd: root,
    env,
    encoding: 'utf8',
    stdio: options.stdio || 'pipe',
  });
  if (result.status !== 0 && !options.allowFail) {
    const stderr = result.stderr?.trim() || '';
    const stdout = result.stdout?.trim() || '';
    throw new Error(`git ${args.join(' ')} failed: ${stderr || stdout}`);
  }
  return (result.stdout || '').trim();
}

export function runGitCapture(args, options = {}) {
  return runGit(args, { ...options, stdio: 'pipe' });
}

export function ensureGitIdentity() {
  const config = loadConfig();
  runGit(['config', 'user.name', config.authorName], { allowFail: false });
  runGit(['config', 'user.email', config.authorEmail], { allowFail: false });
}

export function commitAt(dateIso, message, options = {}) {
  const config = loadConfig();
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: config.authorName,
    GIT_AUTHOR_EMAIL: config.authorEmail,
    GIT_COMMITTER_NAME: config.authorName,
    GIT_COMMITTER_EMAIL: config.authorEmail,
    GIT_AUTHOR_DATE: dateIso,
    GIT_COMMITTER_DATE: dateIso,
  };
  runGit(['add', '--all'], { ...options, authorName: config.authorName, authorEmail: config.authorEmail });
  const result = spawnSync('git', ['commit', '-m', message, '--allow-empty'], {
    cwd: options.cwd || getRoot(),
    env,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.status !== 0) {
    const out = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
    if (!out.includes('nothing to commit')) {
      throw new Error(`git commit failed: ${out}`);
    }
  }
}

export function listCommits(branch = null) {
  const args = ['log', '--format=%H|%an|%ae|%aI|%cI|%s'];
  if (branch === '--all') {
    args.push('--all');
  } else if (branch) {
    args.push(branch);
  }
  const out = runGitCapture(args);
  if (!out) return [];
  return out.split('\n').filter(Boolean).map((line) => {
    const [hash, authorName, authorEmail, authorDate, committerDate, subject] = line.split('|');
    return { hash, authorName, authorEmail, authorDate, committerDate, subject };
  });
}

export function listBranches() {
  const out = runGitCapture(['branch', '--format=%(refname:short)']);
  return out.split('\n').filter(Boolean);
}

export function deleteGitDir(rootDir = getRoot()) {
  const gitDir = path.join(rootDir, '.git');
  if (fs.existsSync(gitDir)) {
    fs.rmSync(gitDir, { recursive: true, force: true });
  }
}

export function initRepository(defaultBranch) {
  runGit(['init', '-b', defaultBranch]);
  ensureGitIdentity();
}

export function getRemoteUrl(remote = 'origin') {
  try {
    return runGitCapture(['remote', 'get-url', remote]);
  } catch {
    return null;
  }
}

export function setRemote(remote, url) {
  try {
    runGitCapture(['remote', 'get-url', remote]);
    runGit(['remote', 'set-url', remote, url]);
  } catch {
    runGit(['remote', 'add', remote, url]);
  }
}

export function listRemoteBranches(remote = 'origin') {
  try {
    const out = runGitCapture(['ls-remote', '--heads', remote]);
    if (!out) return [];
    return out
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split('\t')[1])
      .filter(Boolean)
      .map((ref) => ref.replace('refs/heads/', ''));
  } catch {
    return [];
  }
}

export function tryExec(command) {
  try {
    execSync(command, { stdio: 'pipe', encoding: 'utf8' });
    return true;
  } catch {
    return false;
  }
}
