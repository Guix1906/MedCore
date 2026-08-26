<?php

namespace App\Controllers;

use App\Core\Request;
use App\Core\Response;
use App\Core\Database;

abstract class BaseController
{
    /**
     * Extrai com segurança o company_id exclusivo do JWT validado.
     */
    protected function getTenantCompanyId(Request $request): string
    {
        $companyId = $request->getCompanyId();
        if (empty($companyId)) {
            Response::unauthorized('Clínica não associada ou token de acesso inválido');
        }
        return (string) $companyId;
    }

    /**
     * Busca um recurso garantindo que ele pertence ao tenant.
     * Retorna HTTP 404 caso pertença a outro tenant ou não exista (evita enumeração de IDs).
     */
    protected function findTenantResource(string $table, string $id, string $companyId, string $label = 'Recurso'): array
    {
        $safeTable = preg_replace('/[^a-zA-Z0-9_]/', '', $table);
        $resource = Database::fetchOne("SELECT * FROM {$safeTable} WHERE id = :id AND company_id = :cid LIMIT 1", [
            'id' => $id,
            'cid' => $companyId
        ]);

        if (!$resource) {
            Response::notFound("{$label} não encontrado");
        }

        return $resource;
    }

    /**
     * Executa exclusão com escopo obrigatório de tenant.
     */
    protected function deleteTenantResource(string $table, string $id, string $companyId, string $label = 'Recurso'): void
    {
        $this->findTenantResource($table, $id, $companyId, $label);
        $safeTable = preg_replace('/[^a-zA-Z0-9_]/', '', $table);
        Database::delete($safeTable, 'id = :id AND company_id = :cid', [
            'id' => $id,
            'cid' => $companyId
        ]);
    }

    /**
     * Valida e clamp bounds em parâmetros de paginação (LIMIT).
     */
    protected function sanitizeLimit(mixed $limit, int $default = 20, int $min = 1, int $max = 100): int
    {
        if ($limit === null || $limit === '') {
            return $default;
        }
        $val = (int) $limit;
        return max($min, min($max, $val));
    }

    /**
     * Valida bounds de offset (OFFSET).
     */
    protected function sanitizeOffset(mixed $offset, int $default = 0): int
    {
        if ($offset === null || $offset === '') {
            return $default;
        }
        return max(0, (int) $offset);
    }

    /**
     * Sanitiza ORDER BY contra allowlist explícita de colunas.
     */
    protected function sanitizeOrderBy(?string $column, array $allowedColumns, string $defaultColumn = 'created_at'): string
    {
        if (empty($column)) {
            return $defaultColumn;
        }
        return in_array($column, $allowedColumns, true) ? $column : $defaultColumn;
    }

    /**
     * Sanitiza direção de ordenação (ASC ou DESC).
     */
    protected function sanitizeOrderDir(?string $direction, string $defaultDir = 'DESC'): string
    {
        $dir = strtoupper(trim((string)$direction));
        return in_array($dir, ['ASC', 'DESC'], true) ? $dir : $defaultDir;
    }
}
