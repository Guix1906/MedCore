<?php

declare(strict_types=1);

require_once __DIR__ . '/../src/Autoloader.php';

use App\Autoloader;
use App\Core\Config;
use App\Core\Database;
use App\Helpers\Jwt;

Autoloader::register();
Autoloader::addNamespace('App', __DIR__ . '/../src');

putenv('JWT_SECRET=super_secret_test_key_for_multitenant_tests_2026_clinicmed');
Config::load(__DIR__ . '/../.env');

echo "=== INICIANDO TESTES DE ISOLAMENTO MULTI-TENANT ===\n";

Database::getConnection();

// Criar duas clinicas de teste
$clinicA = 'comp_clinic_test_alpha';
$clinicB = 'comp_clinic_test_beta';

Database::execute("INSERT OR IGNORE INTO companies (id, name, slug) VALUES (:id, 'Clinica Alpha', 'alpha')", ['id' => $clinicA]);
Database::execute("INSERT OR IGNORE INTO companies (id, name, slug) VALUES (:id, 'Clinica Beta', 'beta')", ['id' => $clinicB]);

// Criar usuario na Clinica A e usuario na Clinica B
$userA = ['id' => 'usr_test_a', 'email' => 'a@medcore.com', 'active_company_id' => $clinicA];
$userB = ['id' => 'usr_test_b', 'email' => 'b@medcore.com', 'active_company_id' => $clinicB];

$tokenA = Jwt::encode($userA);
$tokenB = Jwt::encode($userB);

// 1. Criar paciente pertencente a Clinica A
$patientId = 'pat_secret_a_' . bin2hex(random_bytes(4));
Database::insert('patients', [
    'id' => $patientId,
    'company_id' => $clinicA,
    'name' => 'Paciente Super Confidencial Clinica A',
    'cpf' => '12345678909',
    'active' => 1,
]);

// Teste 1: Clinica A busca seus pacientes
$p = Database::fetchOne("SELECT * FROM patients WHERE id = :id AND company_id = :cid", ['id' => $patientId, 'cid' => $clinicA]);
if ($p === null) {
    throw new Exception('FALHA: Clinica A deveria encontrar seu paciente');
}
echo "[PASS] Clinica A localizou seu paciente com sucesso.\n";

// Teste 2: Clinica B tenta buscar paciente da Clinica A
$pB = Database::fetchOne("SELECT * FROM patients WHERE id = :id AND company_id = :cid", ['id' => $patientId, 'cid' => $clinicB]);
if ($pB !== null) {
    throw new Exception('FALHA: Clinica B NAO deve encontrar paciente da Clinica A');
}
echo "[PASS] Clinica B recebeu NULL (isolamento 404) ao consultar paciente da Clinica A.\n";

// Teste 3: Clinica B tenta atualizar paciente da Clinica A
Database::update('patients', ['name' => 'Hacked Name'], 'id = :id AND company_id = :cid', ['id' => $patientId, 'cid' => $clinicB]);
$checkP = Database::fetchOne("SELECT name FROM patients WHERE id = :id", ['id' => $patientId]);
if ($checkP['name'] === 'Hacked Name') {
    throw new Exception('FALHA: Clinica B conseguiu alterar paciente da Clinica A');
}
echo "[PASS] Clinica B impedida de atualizar paciente da Clinica A.\n";

// Teste 4: Clinica B tenta deletar paciente da Clinica A
Database::delete('patients', 'id = :id AND company_id = :cid', ['id' => $patientId, 'cid' => $clinicB]);
$stillExists = Database::fetchOne("SELECT id FROM patients WHERE id = :id", ['id' => $patientId]);
if ($stillExists === null) {
    throw new Exception('FALHA: Clinica B conseguiu apagar paciente da Clinica A');
}
echo "[PASS] Clinica B impedida de apagar paciente da Clinica A.\n";

// Teste 5: Isolamento financeiro
$txId = 'tx_secret_a_' . bin2hex(random_bytes(4));
Database::insert('transactions', [
    'id' => $txId,
    'company_id' => $clinicA,
    'description' => 'Receita Milionaria Alpha',
    'amount' => 50000.00,
    'type' => 'income',
    'status' => 'completed',
    'date' => date('Y-m-d'),
]);

$txB = Database::fetchOne("SELECT * FROM transactions WHERE id = :id AND company_id = :cid", ['id' => $txId, 'cid' => $clinicB]);
if ($txB !== null) {
    throw new Exception('FALHA: Clinica B NAO pode ver transacao da Clinica A');
}
echo "[PASS] Clinica B nao tem acesso aos dados financeiros da Clinica A.\n";

// Limpeza
Database::delete('patients', 'id = :id', ['id' => $patientId]);
Database::delete('transactions', 'id = :id', ['id' => $txId]);
Database::delete('companies', 'id IN (:a, :b)', ['a' => $clinicA, 'b' => $clinicB]);

echo "\n=======================================================\n";
echo " TODOS OS TESTES DE ISOLAMENTO MULTI-TENANT PASSARAM! \n";
echo "=======================================================\n";
