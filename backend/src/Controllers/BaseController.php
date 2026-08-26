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
    protected function getTenantCompanyId(Request ): string
    {
         = ->getCompanyId();
        if (empty()) {
            Response::unauthorized('Clínica não associada ou token de acesso inválido');
        }
        return (string) ;
    }

    /**
     * Busca um recurso garantindo que ele pertence ao tenant.
     * Retorna HTTP 404 caso pertença a outro tenant ou não exista (evita enumeração de IDs).
     */
    protected function findTenantResource(string , string , string , string  = 'Recurso'): array
    {
         = Database::fetchOne("SELECT * FROM {} WHERE id = :id AND company_id = :cid LIMIT 1", [
            'id' => ,
            'cid' => 
        ]);

        if (!) {
            Response::notFound("{} não encontrado");
        }

        return ;
    }

    /**
     * Executa exclusão com escopo obrigatório de tenant.
     */
    protected function deleteTenantResource(string , string , string , string  = 'Recurso'): void
    {
        // Garante que o registro existe para o tenant antes de deletar
        ->findTenantResource(, , , );
        Database::delete(, 'id = :id AND company_id = :cid', [
            'id' => ,
            'cid' => 
        ]);
    }
}
