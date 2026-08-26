<?php

declare(strict_types=1);

require_once __DIR__ . '/../src/Autoloader.php';

use App\Autoloader;
use App\Core\Config;
use App\Core\Database;
use App\Helpers\Jwt;

Autoloader::register();
Autoloader::addNamespace('App', __DIR__ . '/../src');

putenv('JWT_SECRET=7f8d9a2b4c6e1f0e5a3b8c7d9e0f2a4b6c8e1d3f5a7b9c0e2f4a6b8d0e2f4a6b');
Config::load(__DIR__ . '/../.env');

echo "=== TESTES DE SEGURANÇA DO JWT ===\n";

// 1. Geração e validação de token legítimo
$payload = ['sub' => 'usr_123', 'email' => 'teste@medcore.com', 'active_company_id' => 'comp_abc'];
$token = Jwt::encode($payload, 1800);
$decoded = Jwt::decode($token);

if ($decoded === null || $decoded['sub'] !== 'usr_123') {
    throw new Exception('FALHA: Token legítimo não pôde ser decodificado');
}
echo "[PASS] Token JWT legítimo decodificado com sucesso.\n";

// 2. Rejeição de token adulterado
$tamperedToken = $token . 'tampered';
if (Jwt::decode($tamperedToken) !== null) {
    throw new Exception('FALHA: Token adulterado foi aceito');
}
echo "[PASS] Token adulterado foi rejeitado.\n";

// 3. Rejeição de token expirado
$expiredToken = Jwt::encode($payload, -100);
if (Jwt::decode($expiredToken) !== null) {
    throw new Exception('FALHA: Token expirado foi aceito');
}
echo "[PASS] Token expirado foi rejeitado.\n";

// 4. Rejeição de ataque alg: none
$fakeHeader = rtrim(strtr(base64_encode(json_encode(['typ' => 'JWT', 'alg' => 'none'])), '+/', '-_'), '=');
$fakePayload = rtrim(strtr(base64_encode(json_encode(['sub' => 'usr_admin', 'exp' => time() + 3600])), '+/', '-_'), '=');
$fakeNoneToken = "{$fakeHeader}.{$fakePayload}.";
if (Jwt::decode($fakeNoneToken) !== null) {
    throw new Exception('FALHA CRÍTICA: Ataque alg: none foi aceito');
}
echo "[PASS] Ataque alg: none foi bloqueado com sucesso.\n";

// 5. Revogação de token (Logout)
$revokedPayload = ['sub' => 'usr_logout', 'jti' => 'jti_test_revocation_123'];
$logoutToken = Jwt::encode($revokedPayload, 1800);
$decodedBefore = Jwt::decode($logoutToken);
if ($decodedBefore === null) {
    throw new Exception('FALHA: Token antes do logout deveria ser válido');
}

Jwt::revoke('jti_test_revocation_123', 'usr_logout', time() + 1800);
$decodedAfter = Jwt::decode($logoutToken);
if ($decodedAfter !== null) {
    throw new Exception('FALHA: Token revogado ainda foi aceito após logout');
}
echo "[PASS] Token revogado foi rejeitado após logout.\n";

// 6. Abort se JWT_SECRET ausente
putenv('JWT_SECRET=');
try {
    // limpar env
    $ref = new ReflectionClass(Config::class);
    $prop = $ref->getProperty('env');
    $prop->setAccessible(true);
    $prop->setValue(null, []);
    
    Jwt::encode(['test' => 1]);
    throw new Exception('FALHA: Deveria ter abortado com JWT_SECRET ausente');
} catch (RuntimeException $e) {
    echo "[PASS] Boot/execução abortado com sucesso quando JWT_SECRET ausente: " . $e->getMessage() . "\n";
}

echo "\n=======================================================\n";
echo " TODOS OS TESTES DE SEGURANÇA DE JWT PASSARAM! \n";
echo "=======================================================\n";
