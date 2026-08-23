<?php

declare(strict_types=1);

require_once __DIR__ . '/../src/Autoloader.php';

use App\Autoloader;
use App\Core\Config;
use App\Core\Database;

Autoloader::register();
Autoloader::addNamespace('App', __DIR__ . '/../src');

Config::load(__DIR__ . '/../.env');

$db = Database::getConnection();

// 1. Criar tabelas
$schema = file_get_contents(__DIR__ . '/schema.sql');
$db->exec($schema);

echo "Esquema de banco de dados inicializado com sucesso!\n";

// 2. Semear Empresa Padrão
$companyId = 'comp_medcore_default';
Database::execute("INSERT OR IGNORE INTO companies (id, name, slug, phone, email, address, city, state) VALUES (:id, :name, :slug, :phone, :email, :addr, :city, :state)", [
    'id' => $companyId,
    'name' => 'ClinicMed Health Hub',
    'slug' => 'clinicmed',
    'phone' => '(11) 3456-7890',
    'email' => 'contato@clinicmed.com.br',
    'addr' => 'Av. Paulista, 1000 - Bela Vista',
    'city' => 'São Paulo',
    'state' => 'SP',
]);

// 3. Semear Perfil de Admin
$adminId = 'usr_admin_medcore';
Database::execute("INSERT OR IGNORE INTO profiles (id, email, password_hash, full_name, active_company_id, is_active) VALUES (:id, :email, :pass, :name, :cid, 1)", [
    'id' => $adminId,
    'email' => 'admin@medcore.com',
    'pass' => password_hash('admin123', PASSWORD_BCRYPT),
    'name' => 'Dr. Administrador',
    'cid' => $companyId,
]);

Database::execute("INSERT OR IGNORE INTO company_members (id, company_id, user_id, role) VALUES (:id, :cid, :uid, 'admin')", [
    'id' => 'mem_admin_default',
    'cid' => $companyId,
    'uid' => $adminId,
]);

echo "Dados essenciais semeados com sucesso no PHP Backend!\n";
