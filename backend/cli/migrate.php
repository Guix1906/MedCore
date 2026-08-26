<?php

declare(strict_types=1);

require_once __DIR__ . '/../src/Autoloader.php';

use App\Autoloader;
use App\Core\Config;
use App\Core\Database;

Autoloader::register();
Autoloader::addNamespace('App', __DIR__ . '/../src');

Config::load(__DIR__ . '/../.env');

echo "=== MedCore Migration CLI ===\n";

try {
    $db = Database::getConnection();
    $schemaFile = __DIR__ . '/../database/schema.sql';

    if (!file_exists($schemaFile)) {
        throw new RuntimeException("Arquivo de schema não encontrado: {$schemaFile}");
    }

    echo "Executando schema.sql...\n";
    $sql = file_get_contents($schemaFile);
    $db->exec($sql);

    echo "[SUCESSO] Banco de dados migrado com sucesso!\n";
} catch (\Throwable $e) {
    echo "[ERRO] Falha na migração: " . $e->getMessage() . "\n";
    exit(1);
}
