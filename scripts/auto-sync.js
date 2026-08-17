import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const IGNORED_PATHS = [
  '.git',
  'node_modules',
  '.output',
  'dist',
  'dist-ssr',
  '.tanstack',
  '.vinxi',
  '.wrangler',
  '.dev.vars',
  'scratch',
  '.env',
  '.env.local',
  '.env.production'
];

let syncTimeout = null;
let isSyncing = false;
let pendingChanges = false;
const DEBOUNCE_MS = 3000; // Aguarda 3 segundos após a última edição

function isIgnored(filePath) {
  const relative = path.relative(rootDir, filePath).replace(/\\/g, '/');
  return IGNORED_PATHS.some(ignored => relative === ignored || relative.startsWith(ignored + '/'));
}

function runGit(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, { cwd: rootDir, stdio: 'pipe' });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', data => { stdout += data.toString(); });
    proc.stderr.on('data', data => { stderr += data.toString(); });

    proc.on('close', code => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `Exit code ${code}`));
    });
  });
}

async function doSync() {
  if (isSyncing) {
    pendingChanges = true;
    return;
  }

  isSyncing = true;
  pendingChanges = false;

  try {
    const status = await runGit(['status', '--porcelain']);
    if (!status) {
      isSyncing = false;
      return;
    }

    const timestamp = new Date().toLocaleTimeString('pt-BR');
    console.log(`\n[Auto-Sync ${timestamp}] 📝 Alterações detectadas no código. Sincronizando com o GitHub...`);

    await runGit(['add', '.']);
    const commitMsg = `auto-sync: ${new Date().toISOString().replace('T', ' ').substring(0, 19)}`;
    await runGit(['commit', '-m', commitMsg]);
    console.log(`[Auto-Sync ${timestamp}] 💾 Commit realizado: ${commitMsg}`);

    // Push to remote
    await runGit(['push', 'origin', 'main']);
    console.log(`[Auto-Sync ${timestamp}] 🚀 Enviado com sucesso para o GitHub (main)!`);
  } catch (err) {
    console.error(`[Auto-Sync] Erro na sincronização:`, err.message || err);
  } finally {
    isSyncing = false;
    if (pendingChanges) {
      pendingChanges = false;
      scheduleSync(1000);
    }
  }
}

function scheduleSync(delay = DEBOUNCE_MS) {
  if (syncTimeout) clearTimeout(syncTimeout);
  syncTimeout = setTimeout(() => {
    doSync();
  }, delay);
}

console.log('====================================================');
console.log(' 🔄 MedCore Auto-Sync Ativo (Tempo Real -> GitHub)');
console.log(` 📂 Monitorando: ${rootDir}`);
console.log(` 🌐 Repositório: https://github.com/Guix1906/MedCore`);
console.log('====================================================');

// Initial sync
doSync();

// Watch directory recursively
fs.watch(rootDir, { recursive: true }, (eventType, filename) => {
  if (!filename) return;
  const fullPath = path.join(rootDir, filename);
  if (isIgnored(fullPath)) return;

  scheduleSync();
});
