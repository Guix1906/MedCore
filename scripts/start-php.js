import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const backendDir = path.join(rootDir, "backend");
const publicDir = path.join(backendDir, "public");
const iniFile = path.join(backendDir, "php.ini");

// Detectar executável PHP
const winGetPhp = path.join(
  process.env.LOCALAPPDATA || "",
  "Microsoft\\WinGet\\Packages\\PHP.PHP.8.2_Microsoft.Winget.Source_8wekyb3d8bbwe\\php.exe"
);

let phpExe = "php";
if (fs.existsSync(winGetPhp)) {
  phpExe = winGetPhp;
}

console.log(`[MedCore PHP] Iniciando servidor PHP em http://localhost:8000`);
console.log(`[MedCore PHP] Executável: ${phpExe}`);
console.log(`[MedCore PHP] Raiz pública: ${publicDir}`);

const args = ["-S", "localhost:8000", "-t", publicDir];
if (fs.existsSync(iniFile)) {
  args.unshift(iniFile);
  args.unshift("-c");
}

const phpProcess = spawn(phpExe, args, {
  cwd: backendDir,
  stdio: "inherit",
});

phpProcess.on("error", (err) => {
  console.error("[MedCore PHP] Erro ao iniciar PHP:", err.message);
});

phpProcess.on("exit", (code) => {
  console.log(`[MedCore PHP] Servidor finalizado com código ${code}`);
});
