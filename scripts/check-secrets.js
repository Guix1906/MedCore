import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const SECRET_PATTERNS = [
  { name: 'Gemini API Key', regex: /AIzaSy[A-Za-z0-9_-]{33}|AQ\.[A-Za-z0-9_-]{40,}/ },
  { name: 'Supabase Service Role Key', regex: /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]*service_role[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+/ },
  { name: 'Private Key / JWT Secret', regex: /-----BEGIN PRIVATE KEY-----/ },
  { name: 'Tracked SQLite DB', regex: /\.(sqlite|sqlite3|db)$/i },
];

export function scanStagedFiles() {
  console.log('?? Verificando segredos e conformidade de segurança nos arquivos staged...');

  let stagedFiles = [];
  try {
    const stdout = execSync('git diff --cached --name-only', { cwd: rootDir, encoding: 'utf8' });
    stagedFiles = stdout.split('\n').map(s => s.trim()).filter(Boolean);
  } catch (err) {
    console.warn('Não foi possível obter lista de arquivos staged do git:', err.message);
    return true;
  }

  if (!stagedFiles.length) {
    console.log('? Nenhum arquivo staged para verificação.');
    return true;
  }

  let foundViolation = false;

  for (const relPath of stagedFiles) {
    // 1. Proibir commit de arquivos de banco SQLite
    if (/\.(sqlite|sqlite3|db)$/i.test(relPath)) {
      console.error(`? [BLOQUEIO DE SEGURANÇA] Tentativa de comitar banco SQLite: ${relPath}`);
      foundViolation = true;
      continue;
    }

    // 2. Proibir commit de .env com segredos
    if (relPath === '.env' || relPath === 'backend/.env' || relPath.endsWith('.env.local')) {
      console.error(`? [BLOQUEIO DE SEGURANÇA] Tentativa de comitar arquivo de ambiente: ${relPath}`);
      foundViolation = true;
      continue;
    }

    const fullPath = path.join(rootDir, relPath);
    if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
      continue;
    }

    // Pular verificação de documentação de auditoria que menciona padrões sanitizados
    if (relPath.startsWith('docs/')) {
      continue;
    }

    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      for (const pattern of SECRET_PATTERNS) {
        if (pattern.name.includes('SQLite')) continue;
        if (pattern.regex.test(content)) {
          console.error(`? [BLOQUEIO DE SEGURANÇA] Possível segredo (${pattern.name}) detectado em: ${relPath}`);
          foundViolation = true;
        }
      }
    } catch {
      // Arquivo binário
    }
  }

  if (foundViolation) {
    console.error('\n?? COMMIT ABORTADO: Remova os segredos / arquivos sensíveis antes de comitar.');
    return false;
  }

  console.log('? Verificação de segurança concluída com sucesso. Zero segredos detectados.');
  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const ok = scanStagedFiles();
  if (!ok) process.exit(1);
}
