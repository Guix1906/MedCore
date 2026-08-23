<?php

namespace App\Core;

use PDO;
use PDOException;

class Database
{
    private static ?PDO $instance = null;

    public static function getConnection(): PDO
    {
        if (self::$instance === null) {
            $driver = Config::get('DB_DRIVER', 'sqlite');

            try {
                if ($driver === 'sqlite') {
                    $dbPath = Config::get('DB_PATH', __DIR__ . '/../../database/medcore.sqlite');
                    $dir = dirname($dbPath);
                    if (!is_dir($dir)) {
                        mkdir($dir, 0777, true);
                    }
                    self::$instance = new PDO("sqlite:{$dbPath}");
                    self::$instance->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
                    self::$instance->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
                    self::$instance->exec('PRAGMA journal_mode = WAL;');
                    self::$instance->exec('PRAGMA foreign_keys = ON;');
                } elseif ($driver === 'pgsql') {
                    $host = Config::get('DB_HOST', 'localhost');
                    $port = Config::get('DB_PORT', '5432');
                    $dbname = Config::get('DB_DATABASE', 'medcore');
                    $user = Config::get('DB_USERNAME', 'postgres');
                    $pass = Config::get('DB_PASSWORD', '');
                    $dsn = "pgsql:host={$host};port={$port};dbname={$dbname}";
                    self::$instance = new PDO($dsn, $user, $pass, [
                        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                    ]);
                } elseif ($driver === 'mysql') {
                    $host = Config::get('DB_HOST', 'localhost');
                    $port = Config::get('DB_PORT', '3306');
                    $dbname = Config::get('DB_DATABASE', 'medcore');
                    $user = Config::get('DB_USERNAME', 'root');
                    $pass = Config::get('DB_PASSWORD', '');
                    $charset = Config::get('DB_CHARSET', 'utf8mb4');
                    $dsn = "mysql:host={$host};port={$port};dbname={$dbname};charset={$charset}";
                    self::$instance = new PDO($dsn, $user, $pass, [
                        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                    ]);
                } else {
                    throw new PDOException("Driver de banco de dados não suportado: {$driver}");
                }
            } catch (PDOException $e) {
                http_response_code(500);
                echo json_encode([
                    'success' => false,
                    'error' => 'Falha na conexão com o banco de dados: ' . $e->getMessage()
                ]);
                exit;
            }
        }

        return self::$instance;
    }

    public static function fetchAll(string $sql, array $params = []): array
    {
        $stmt = self::getConnection()->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }

    public static function fetchOne(string $sql, array $params = []): ?array
    {
        $stmt = self::getConnection()->prepare($sql);
        $stmt->execute($params);
        $result = $stmt->fetch();
        return $result === false ? null : $result;
    }

    public static function execute(string $sql, array $params = []): bool
    {
        $stmt = self::getConnection()->prepare($sql);
        return $stmt->execute($params);
    }

    public static function insert(string $table, array $data): string|int|null
    {
        $columns = implode(', ', array_keys($data));
        $placeholders = implode(', ', array_map(fn($k) => ":{$k}", array_keys($data)));
        $sql = "INSERT INTO {$table} ({$columns}) VALUES ({$placeholders})";

        self::execute($sql, $data);
        return $data['id'] ?? self::getConnection()->lastInsertId();
    }

    public static function update(string $table, array $data, string $where, array $whereParams = []): bool
    {
        $set = implode(', ', array_map(fn($k) => "{$k} = :set_{$k}", array_keys($data)));
        $sql = "UPDATE {$table} SET {$set} WHERE {$where}";

        $params = [];
        foreach ($data as $k => $v) {
            $params["set_{$k}"] = $v;
        }
        foreach ($whereParams as $k => $v) {
            $params[$k] = $v;
        }

        return self::execute($sql, $params);
    }

    public static function delete(string $table, string $where, array $whereParams = []): bool
    {
        $sql = "DELETE FROM {$table} WHERE {$where}";
        return self::execute($sql, $whereParams);
    }

    public static function beginTransaction(): bool
    {
        return self::getConnection()->beginTransaction();
    }

    public static function commit(): bool
    {
        return self::getConnection()->commit();
    }

    public static function rollback(): bool
    {
        return self::getConnection()->rollBack();
    }
}
