<?php

namespace App\Controllers;

use App\Core\Request;
use App\Core\Response;
use App\Core\Database;

class SearchController
{
    public function search(Request $request): void
    {
        $q = trim($request->query('q', ''));
        if (empty($q)) {
            Response::success([]);
        }

        $results = [];
        $searchTerm = "%{$q}%";

        // 1. Pacientes
        $patients = Database::fetchAll("
            SELECT id, name as label, COALESCE(phone, email, cpf, '') as extra, created_at 
            FROM patients 
            WHERE name LIKE :q OR cpf LIKE :q OR phone LIKE :q 
            LIMIT 10
        ", ['q' => $searchTerm]);
        foreach ($patients as $p) {
            $results[] = [
                'kind' => 'patient',
                'id' => $p['id'],
                'label' => $p['label'],
                'extra' => $p['extra'],
                'created_at' => $p['created_at'],
            ];
        }

        // 2. Médicos
        $doctors = Database::fetchAll("
            SELECT id, name as label, COALESCE(specialty, crm, '') as extra, created_at 
            FROM doctors 
            WHERE name LIKE :q OR specialty LIKE :q OR crm LIKE :q 
            LIMIT 5
        ", ['q' => $searchTerm]);
        foreach ($doctors as $d) {
            $results[] = [
                'kind' => 'doctor',
                'id' => $d['id'],
                'label' => $d['label'],
                'extra' => $d['extra'],
                'created_at' => $d['created_at'],
            ];
        }

        // 3. Tratamentos
        $treatments = Database::fetchAll("
            SELECT t.id, t.title as label, p.name as extra, t.created_at 
            FROM treatments t 
            JOIN patients p ON p.id = t.patient_id 
            WHERE t.title LIKE :q OR p.name LIKE :q 
            LIMIT 5
        ", ['q' => $searchTerm]);
        foreach ($treatments as $t) {
            $results[] = [
                'kind' => 'treatment',
                'id' => $t['id'],
                'label' => $t['label'],
                'extra' => 'Paciente: ' . $t['extra'],
                'created_at' => $t['created_at'],
            ];
        }

        // 4. Estoque
        $items = Database::fetchAll("
            SELECT id, name as label, COALESCE(category, '') as extra, created_at 
            FROM inventory_items 
            WHERE name LIKE :q OR category LIKE :q 
            LIMIT 5
        ", ['q' => $searchTerm]);
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
