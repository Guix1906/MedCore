<?php

namespace App\Controllers;

use App\Core\Request;
use App\Core\Response;
use App\Core\Database;
use App\Helpers\Jwt;

class AuthController
{
    public function login(Request $request): void
    {
        $email = trim(strtolower((string) $request->input('email', '')));
        $password = (string) $request->input('password', '');
        $ip = $_SERVER['REMOTE_ADDR'] ?? '127.0.0.1';

        if (empty($email) || empty($password)) {
            Response::error('Email e senha são obrigatórios', 422);
        }

        // 1. Rate limiting: 5 tentativas por 15 minutos por IP + email
        $this->ensureLoginAttemptsTable();
        $window = time() - (15 * 60);
        $attempts = Database::fetchOne(
            "SELECT COUNT(*) as total FROM login_attempts WHERE (ip = :ip OR email = :email) AND attempted_at > :window",
            ['ip' => $ip, 'email' => $email, 'window' => $window]
        );

        if (($attempts['total'] ?? 0) >= 5) {
            error_log(sprintf('[AUTH_SECURITY] Bloqueio por rate limit para IP: %s e Email: %s', $ip, $email));
            Response::error('Muitas tentativas de login. Tente novamente em 15 minutos.', 429);
        }

        // 2. Busca estrita do usuário
        $user = Database::fetchOne("SELECT * FROM profiles WHERE lower(email) = :email LIMIT 1", [
            'email' => $email
        ]);

        // 3. Validação de existência e hash de senha
        if (!$user) {
            $this->recordFailedAttempt($ip, $email);
            Response::error('Credenciais inválidas', 401);
        }

        if (empty($user['password_hash'])) {
            Database::execute("UPDATE profiles SET must_reset_password = 1 WHERE id = :id", ['id' => $user['id']]);
            $this->recordFailedAttempt($ip, $email);
            Response::error('Credenciais inválidas', 401);
        }

        if (!password_verify($password, $user['password_hash'])) {
            $this->recordFailedAttempt($ip, $email);
            Response::error('Credenciais inválidas', 401);
        }

        if (isset($user['is_active']) && (int)$user['is_active'] === 0) {
            Response::error('Conta inativa ou bloqueada', 403);
        }

        // Limpar tentativas falhas após sucesso
        Database::execute("DELETE FROM login_attempts WHERE ip = :ip OR email = :email", [
            'ip' => $ip,
            'email' => $email
        ]);

        // Buscar membros e empresas autorizadas
        $companies = Database::fetchAll("
            SELECT c.*, cm.role 
            FROM companies c 
            JOIN company_members cm ON cm.company_id = c.id 
            WHERE cm.user_id = :user_id
        ", ['user_id' => $user['id']]);

        $activeCompanyId = $user['active_company_id'] ?? ($companies[0]['id'] ?? null);

        $token = Jwt::encode([
            'sub' => $user['id'],
            'id' => $user['id'],
            'email' => $user['email'],
            'full_name' => $user['full_name'],
            'active_company_id' => $activeCompanyId,
        ]);

        Response::success([
            'token' => $token,
            'user' => [
                'id' => $user['id'],
                'email' => $user['email'],
                'full_name' => $user['full_name'],
                'avatar_url' => $user['avatar_url'] ?? null,
                'active_company_id' => $activeCompanyId,
            ],
            'companies' => $companies,
        ], 'Login realizado com sucesso');
    }

    private function ensureLoginAttemptsTable(): void
    {
        try {
            Database::execute("
                CREATE TABLE IF NOT EXISTS login_attempts (
                    id TEXT PRIMARY KEY,
                    ip TEXT NOT NULL,
                    email TEXT NOT NULL,
                    attempted_at INTEGER NOT NULL
                )
            ");
            Database::execute("CREATE INDEX IF NOT EXISTS idx_login_attempts ON login_attempts(ip, email, attempted_at)");
        } catch (\Throwable) {
            // Silencioso se já existir
        }
    }

    private function recordFailedAttempt(string $ip, string $email): void
    {
        error_log(sprintf('[AUTH_SECURITY] Tentativa de login falha para Email: %s a partir do IP: %s', $email, $ip));
        try {
            Database::execute("INSERT INTO login_attempts (id, ip, email, attempted_at) VALUES (:id, :ip, :email, :attempted_at)", [
                'id' => 'att_' . substr(bin2hex(random_bytes(8)), 0, 16),
                'ip' => $ip,
                'email' => $email,
                'attempted_at' => time()
            ]);
        } catch (\Throwable) {
            // Não abortar por erro de log
        }
    }

    public function register(Request $request): void
    {
        $email = trim($request->input('email', ''));
        $password = trim($request->input('password', ''));
        $fullName = trim($request->input('full_name', $request->input('fullName', '')));

        if (empty($email) || empty($password)) {
            Response::error('Email e senha são obrigatórios', 422);
        }

        $existing = Database::fetchOne("SELECT id FROM profiles WHERE email = :email", ['email' => $email]);
        if ($existing) {
            Response::error('Este email já está cadastrado', 409);
        }

        $userId = 'usr_' . substr(bin2hex(random_bytes(8)), 0, 12);
        $companyId = 'comp_' . substr(bin2hex(random_bytes(8)), 0, 12);

        Database::beginTransaction();
        try {
            Database::insert('companies', [
                'id' => $companyId,
                'name' => 'Minha Clínica',
                'slug' => 'clinica-' . substr(bin2hex(random_bytes(4)), 0, 6),
            ]);

            Database::insert('profiles', [
                'id' => $userId,
                'email' => $email,
                'password_hash' => password_hash($password, PASSWORD_BCRYPT),
                'full_name' => $fullName ?: explode('@', $email)[0],
                'active_company_id' => $companyId,
                'is_active' => 1,
            ]);

            Database::insert('company_members', [
                'id' => 'mem_' . substr(bin2hex(random_bytes(6)), 0, 10),
                'company_id' => $companyId,
                'user_id' => $userId,
                'role' => 'admin'
            ]);

            Database::commit();

            $token = Jwt::encode([
                'sub' => $userId,
                'id' => $userId,
                'email' => $email,
                'full_name' => $fullName,
                'active_company_id' => $companyId,
            ]);

            Response::success([
                'token' => $token,
                'user' => [
                    'id' => $userId,
                    'email' => $email,
                    'full_name' => $fullName,
                    'active_company_id' => $companyId,
                ],
            ], 'Conta criada com sucesso', 201);
        } catch (\Throwable $e) {
            Database::rollback();
            Response::error('Erro ao cadastrar usuário: ' . $e->getMessage(), 500);
        }
    }

    public function me(Request $request): void
    {
        $userId = $request->getUserId();
        $user = Database::fetchOne("SELECT id, email, full_name, avatar_url, phone, active_company_id FROM profiles WHERE id = :id", [
            'id' => $userId
        ]);

        if (!$user) {
            Response::unauthorized('Usuário não encontrado');
        }

        $companies = Database::fetchAll("
            SELECT c.*, cm.role 
            FROM companies c 
            JOIN company_members cm ON cm.company_id = c.id 
            WHERE cm.user_id = :user_id
        ", ['user_id' => $userId]);

        Response::success([
            'user' => $user,
            'companies' => $companies,
        ]);
    }
}
