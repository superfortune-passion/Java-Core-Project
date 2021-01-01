import fs from 'fs';
import path from 'path';
import { getRoot, loadConfig } from './config.mjs';

export function shouldExclude(relativePath, patterns) {
  const normalized = relativePath.replace(/\\/g, '/');
  if (normalized.startsWith('_automation/') && !normalized.startsWith('_automation/.snapshot/')) {
    return true;
  }
  return patterns.some((pattern) => new RegExp(pattern).test(normalized));
}

export function discoverFiles(rootDir = getRoot()) {
  const config = loadConfig();
  const files = [];

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(rootDir, full).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        if (!shouldExclude(rel + '/', config.excludePatterns)) {
          walk(full);
        }
      } else if (!shouldExclude(rel, config.excludePatterns)) {
        files.push(rel);
      }
    }
  }

  walk(rootDir);
  return files.sort();
}

export function getFeatureBranch(relativePath, branchMap) {
  const top = relativePath.split('/')[0];
  return branchMap[top] || `feat/${top.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

export function groupFilesByBranch(files, branchMap) {
  const groups = new Map();
  for (const file of files) {
    const branch = getFeatureBranch(file, branchMap);
    if (!groups.has(branch)) groups.set(branch, []);
    groups.get(branch).push(file);
  }
  for (const list of groups.values()) {
    list.sort();
  }
  return groups;
}

export function inferFunctionality(relativePath) {
  const name = path.basename(relativePath);
  const ext = path.extname(name).toLowerCase();
  const base = name.slice(0, name.length - ext.length);

  if (name === 'README.md') return 'add project documentation';
  if (name === 'build.gradle') return 'add gradle build configuration';
  if (name === 'settings.gradle') return 'add gradle settings';
  if (name === 'gradlew') return 'add gradle wrapper script';
  if (name === 'gradlew.bat') return 'add gradle wrapper batch script';
  if (name.includes('gradle-wrapper.properties')) return 'add gradle wrapper properties';
  if (name.includes('gradle-wrapper.jar')) return 'add gradle wrapper jar';
  if (ext === '.java') {
    const words = base
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .toLowerCase()
      .trim();
    return `implement ${words || 'java source'}`;
  }
  if (ext === '.json') return 'add json configuration data';
  if (ext === '.xml') return 'add xml configuration';
  if (ext === '.properties') return 'add properties configuration';
  if (ext === '.iml') return 'add module configuration';
  if (ext === '.zip') return 'add lesson archive resource';
  if (ext === '.gitignore') return 'add ignore rules';
  return 'add project resource';
}

export function commitMessage(relativePath) {
  const name = path.basename(relativePath);
  return `feat: ${name} ${inferFunctionality(relativePath)}`;
}

export function copyFileFromSnapshot(snapshotDir, rootDir, relativePath) {
  const src = path.join(snapshotDir, relativePath);
  const dest = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

export function removePath(rootDir, relativePath) {
  const full = path.join(rootDir, relativePath);
  if (fs.existsSync(full)) {
    fs.rmSync(full, { recursive: true, force: true });
  }
}

export function snapshotProject(sourceRoot, snapshotDir, files) {
  fs.rmSync(snapshotDir, { recursive: true, force: true });
  fs.mkdirSync(snapshotDir, { recursive: true });
  for (const file of files) {
    const src = path.join(sourceRoot, file);
    const dest = path.join(snapshotDir, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

export function restoreFromSnapshot(snapshotDir, rootDir, files) {
  for (const file of files) {
    copyFileFromSnapshot(snapshotDir, rootDir, file);
  }
}

export function clearProjectFiles(rootDir, files, keepDirs = ['_automation']) {
  for (const file of files) {
    removePath(rootDir, file);
  }
  pruneEmptyDirs(rootDir, keepDirs);
}

function pruneEmptyDirs(dir, keepDirs) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(getRoot(), full).replace(/\\/g, '/');
    if (keepDirs.some((k) => rel === k || rel.startsWith(`${k}/`))) continue;
    pruneEmptyDirs(full, keepDirs);
    if (fs.readdirSync(full).length === 0) {
      fs.rmdirSync(full);
    }
  }
}
