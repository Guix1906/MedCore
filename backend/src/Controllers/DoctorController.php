<?php

namespace App\Controllers;

use App\Core\Request;
use App\Core\Response;
use App\Core\Database;

class DoctorController extends BaseController
{
    public function index(Request $request): void
    {
        $companyId = $this->getTenantCompanyId($request);
        $doctors = Database::fetchAll("
            SELECT id, name, email, specialty, crm, role, avatar_url, active, created_at 
            FROM doctors 
            WHERE (company_id = :cid OR company_id IS NULL) AND active = 1 
            ORDER BY name ASC
        ", ['cid' => $companyId]);

        foreach ($doctors as &$d) {
            $d['active'] = (bool) $d['active'];
        }

        Response::success($doctors);
    }

    public function show(Request $request, array $params): void
    {
        $companyId = $this->getTenantCompanyId($request);
        $id = $params['id'] ?? '';
        $doctor = Database::fetchOne(
            "SELECT * FROM doctors WHERE id = :id AND (company_id = :cid OR company_id IS NULL) LIMIT 1",
            ['id' => $id, 'cid' => $companyId]
        );

        if (!$doctor) {
            Response::notFound('Médico não encontrado');
        }

        $doctor['active'] = (bool) $doctor['active'];
        Response::success($doctor);
    }
}
