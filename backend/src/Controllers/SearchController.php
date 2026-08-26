<?php

namespace App\Controllers;

use App\Core\Request;
use App\Core\Response;
use App\Core\Database;

class SearchController extends BaseController
{
    public function search(Request $request): void
    {
        $companyId = $this->getTenantCompanyId($request);
        $q = trim((string) $request->query('q', ''));
        if (empty($q)) {
            Response::success([]);
        }

        $results = [];
        $searchTerm = "%{$q}%";

        // 1. Pacientes do tenant
        $patients = Database::fetchAll("
            SELECT id, name as label, COALESCE(phone, email, cpf, '') as extra, created_at 
            FROM patients 
            WHERE company_id = :cid AND (name LIKE :q OR cpf LIKE :q OR phone LIKE :q)
            LIMIT 10
        ", ['cid' => $companyId, 'q' => $searchTerm]);
        foreach ($patients as $p) {
            $results[] = [
                'kind' => 'patient',
                'id' => $p['id'],
                'label' => $p['label'],
                'extra' => $p['extra'],
                'created_at' => $p['created_at'],
            ];
        }

        // 2. Médicos do tenant
        $doctors = Database::fetchAll("
            SELECT id, name as label, COALESCE(specialty, crm, '') as extra, created_at 
            FROM doctors 
            WHERE (company_id = :cid OR company_id IS NULL) AND active = 1 AND (name LIKE :q OR specialty LIKE :q OR crm LIKE :q)
            LIMIT 5
        ", ['cid' => $companyId, 'q' => $searchTerm]);
        foreach ($doctors as $d) {
            $results[] = [
                'kind' => 'doctor',
                'id' => $d['id'],
                'label' => $d['label'],
                'extra' => $d['extra'],
                'created_at' => $d['created_at'],
            ];
        }

        // 3. Tratamentos do tenant
        $treatments = Database::fetchAll("
            SELECT t.id, t.title as label, p.name as extra, t.created_at 
            FROM treatments t 
            JOIN patients p ON p.id = t.patient_id 
            WHERE t.company_id = :cid AND (t.title LIKE :q OR p.name LIKE :q)
            LIMIT 5
        ", ['cid' => $companyId, 'q' => $searchTerm]);
        foreach ($treatments as $t) {
            $results[] = [
                'kind' => 'treatment',
                'id' => $t['id'],
                'label' => $t['label'],
                'extra' => 'Paciente: ' . $t['extra'],
                'created_at' => $t['created_at'],
            ];
        }

        // 4. Estoque do tenant
        $items = Database::fetchAll("
            SELECT id, name as label, COALESCE(category, '') as extra, created_at 
            FROM inventory_items 
            WHERE (company_id = :cid OR company_id IS NULL) AND active = 1 AND (name LIKE :q OR category LIKE :q)
            LIMIT 5
        ", ['cid' => $companyId, 'q' => $searchTerm]);
        foreach ($items as $it) {
            $results[] = [
                'kind' => 'inventory',
                'id' => $it['id'],
                'label' => $it['label'],
                'extra' => 'Estoque: ' . $it['extra'],
                'created_at' => $it['created_at'],
            ];
        }

        Response::success($results);
    }
}
