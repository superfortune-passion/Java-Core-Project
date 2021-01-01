import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

export function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

export function getRoot() {
  return ROOT;
}

export function getAutomationDir() {
  return path.join(ROOT, '_automation');
}

export function getSnapshotDir() {
  return path.join(ROOT, '_automation', '.snapshot');
}

export function getManifestPath() {
  return path.join(ROOT, '_automation', 'manifest.json');
}
