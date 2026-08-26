import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import { scanStagedFiles } from './check-secrets.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

function runGit(args) {
  const result = spawnSync('git', args, { cwd: rootDir, encoding: 'utf8', stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`Erro ao executar git ${args.join(' ')}`);
  }
}

async function manualSync() {
  console.log('====================================================');
  console.log(' 🔄 MedCore Sincronização Manual (Sob Demanda)');
  console.log('====================================================');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const branch = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: rootDir, encoding: 'utf8' }).stdout.trim();
  console.log(`📌 Branch atual: ${branch}`);

  rl.question(`Deseja sincronizar as alterações na branch "${branch}"? (s/N): `, (answer) => {
    rl.close();
    if (answer.trim().toLowerCase() !== 's' && answer.trim().toLowerCase() !== 'sim') {
      console.log('Operação cancelada pelo usuário.');
      process.exit(0);
    }

    try {
      console.log('1. Executando verificações de tipos...');
      const tsc = spawnSync('npx', ['tsc', '--noEmit'], { cwd: rootDir, encoding: 'utf8', stdio: 'inherit', shell: true });
      if (tsc.status !== 0) {
        console.error('❌ Falha na verificação de tipos. Corrija os erros antes de sincronizar.');
        process.exit(1);
      }

      console.log('2. Verificando segredos com check-secrets...');
      const ok = scanStagedFiles();
      if (!ok) {
        console.error('❌ Segredos detectados. Sincronização cancelada.');
        process.exit(1);
      }

      console.log('3. Enviando alterações para o remote...');
      runGit(['push', 'origin', branch]);

      console.log('✅ Sincronização concluída com sucesso!');
    } catch (err) {
      console.error('❌ Erro na sincronização:', err.message);
      process.exit(1);
    }
  });
}

manualSync();

