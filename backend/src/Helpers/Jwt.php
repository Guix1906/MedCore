<?php

namespace App\Helpers;

use App\Core\Config;
use App\Core\Database;
use RuntimeException;

class Jwt
{
    private const DEFAULT_EXPIRY_SECONDS = 1800; // 30 minutos
    private const ISSUER = 'medcore-api';
    private const AUDIENCE = 'medcore-client';

    private static function getSecret(): string
    {
        $secret = Config::get('JWT_SECRET');
        if (empty($secret) || strlen(trim((string)$secret)) < 32) {
            throw new RuntimeException('ERRO CRÍTICO DE SEGURANÇA: JWT_SECRET ausente ou possui tamanho insuficiente (< 32 caracteres). O servidor não iniciará.');
        }
        return (string) $secret;
    }

    /**
     * Gera um token de acesso JWT (HS256) com claims padrão RFC 7519.
     */
    public static function encode(array $payload, int $expirySeconds = self::DEFAULT_EXPIRY_SECONDS): string
    {
        $header = json_encode([
            'typ' => 'JWT',
            'alg' => 'HS256'
        ], JSON_UNESCAPED_SLASHES);

        $now = time();
        $payload['iss'] = self::ISSUER;
        $payload['aud'] = self::AUDIENCE;
        $payload['iat'] = $now;
        $payload['nbf'] = $now;
        $payload['exp'] = $now + $expirySeconds;
        $payload['jti'] = $payload['jti'] ?? ('jti_' . bin2hex(random_bytes(16)));

        $payloadJson = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

        $base64UrlHeader = self::base64UrlEncode($header);
        $base64UrlPayload = self::base64UrlEncode($payloadJson);

        $signature = hash_hmac('sha256', "{$base64UrlHeader}.{$base64UrlPayload}", self::getSecret(), true);
        $base64UrlSignature = self::base64UrlEncode($signature);

        return "{$base64UrlHeader}.{$base64UrlPayload}.{$base64UrlSignature}";
    }

    /**
     * Decodifica e valida rigorosamente o token JWT.
     */
    public static function decode(string $jwt): ?array
    {
        $parts = explode('.', trim($jwt));
        if (count($parts) !== 3) {
            return null;
        }

        [$header64, $payload64, $signature64] = $parts;

        // 1. Validar Header e Algoritmo (rejeitar 'none' ou algoritmos não permitidos)
        $headerJson = self::base64UrlDecode($header64);
        $header = json_decode($headerJson, true);
        if (!is_array($header) || ($header['alg'] ?? '') !== 'HS256' || ($header['typ'] ?? '') !== 'JWT') {
            return null;
        }

        // 2. Validar Assinatura Criptográfica em tempo constante
        $signature = self::base64UrlDecode($signature64);
        $expectedSignature = hash_hmac('sha256', "{$header64}.{$payload64}", self::getSecret(), true);

        if (!hash_equals($signature, $expectedSignature)) {
            return null;
        }

        // 3. Decodificar Payload
        $payload = json_decode(self::base64UrlDecode($payload64), true);
        if (!is_array($payload)) {
            return null;
        }

        $now = time();

        // 4. Validar Expiração e Not Before (com tolerância de 5 segundos)
        if (isset($payload['exp']) && ($payload['exp'] < ($now - 5))) {
            return null;
        }

        if (isset($payload['nbf']) && ($payload['nbf'] > ($now + 5))) {
            return null;
        }

        // 5. Validar Lista de Revogação (Logout/Troca de Senha)
        if (!empty($payload['jti']) && self::isRevoked($payload['jti'])) {
            return null;
        }

        return $payload;
    }

    /**
     * Revoga um token ativo por JTI.
     */
    public static function revoke(string $jti, ?string $userId = null, int $expiresAt = 0): bool
    {
        if (empty($jti)) {
            return false;
        }

        self::ensureRevocationTable();

        try {
            return Database::execute("
                INSERT OR REPLACE INTO revoked_tokens (jti, user_id, revoked_at, expires_at)
                VALUES (:jti, :uid, :revoked_at, :expires_at)
            ", [
                'jti' => $jti,
                'uid' => $userId,
                'revoked_at' => time(),
                'expires_at' => $expiresAt > 0 ? $expiresAt : (time() + 86400)
            ]);
        } catch (\Throwable) {
            return false;
        }
    }

    /**
     * Verifica se um JTI está na lista de revogação.
     */
    public static function isRevoked(string $jti): bool
    {
        if (empty($jti)) {
            return false;
        }

        self::ensureRevocationTable();

        try {
            $row = Database::fetchOne("SELECT jti FROM revoked_tokens WHERE jti = :jti AND expires_at > :now LIMIT 1", [
                'jti' => $jti,
                'now' => time()
            ]);
            return !empty($row);
        } catch (\Throwable) {
            return false;
        }
    }

    private static function ensureRevocationTable(): void
    {
        try {
            Database::execute("
                CREATE TABLE IF NOT EXISTS revoked_tokens (
                    jti TEXT PRIMARY KEY,
                    user_id TEXT,
                    revoked_at INTEGER NOT NULL,
                    expires_at INTEGER NOT NULL
                )
            ");
            Database::execute("CREATE INDEX IF NOT EXISTS idx_revoked_tokens_exp ON revoked_tokens(expires_at)");
        } catch (\Throwable) {
            // Silencioso
        }
    }

    private static function base64UrlEncode(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }

    private static function base64UrlDecode(string $data): string
    {
        return base64_decode(strtr($data, '-_', '+/') . str_repeat('=', 3 - (3 + strlen($data)) % 4));
    }
}
