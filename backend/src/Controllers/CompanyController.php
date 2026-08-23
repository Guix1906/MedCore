<?php

namespace App\Controllers;

use App\Core\Request;
use App\Core\Response;
use App\Core\Database;

class CompanyController
{
    public function members(Request $request): void
    {
        $companyId = $request->getCompanyId() ?: 'comp_medcore_default';
        $members = Database::fetchAll("
            SELECT cm.id, cm.company_id, cm.user_id, cm.role,
                   p.full_name, p.email, p.avatar_url
            FROM company_members cm
            JOIN profiles p ON p.id = cm.user_id
            WHERE cm.company_id = :cid
        ", ['cid' => $companyId]);

        Response::success($members);
    }

    public function settings(Request $request): void
    {
        $companyId = $request->getCompanyId() ?: 'comp_medcore_default';
        $settings = Database::fetchOne("SELECT * FROM clinic_settings WHERE company_id = :cid", ['cid' => $companyId]);

        if (!$settings) {
            $default = [
                'id' => 'set_' . substr(bin2hex(random_bytes(6)), 0, 12),
                'company_id' => $companyId,
                'clinic_name' => 'ClinicMed Health Hub',
                'phone' => '(11) 3456-7890',
                'email' => 'contato@clinicmed.com.br',
                'address' => 'Av. Paulista, 1000 - Bela Vista',
                'city' => 'São Paulo',
                'state' => 'SP',
                'zip_code' => '01310-100',
                'cnpj' => '12.345.678/0001-90',
            ];
            Database::insert('clinic_settings', $default);
            $settings = Database::fetchOne("SELECT * FROM clinic_settings WHERE company_id = :cid", ['cid' => $companyId]);
        }

        Response::success($settings);
    }

    public function updateSettings(Request $request): void
    {
        $companyId = $request->getCompanyId() ?: 'comp_medcore_default';
        $fields = ['clinic_name', 'phone', 'email', 'address', 'city', 'state', 'zip_code', 'cnpj', 'logo_url'];
        $updateData = [];

        foreach ($fields as $field) {
            $val = $request->input($field);
            if ($val !== null) {
                $updateData[$field] = $val;
            }
        }

        if (!empty($updateData)) {
            $updateData['updated_at'] = date('Y-m-d H:i:s');
            Database::update('clinic_settings', $updateData, 'company_id = :cid', ['cid' => $companyId]);
        }

        $settings = Database::fetchOne("SELECT * FROM clinic_settings WHERE company_id = :cid", ['cid' => $companyId]);
        Response::success($settings, 'Configurações salvas');
    }

    public function serviceTypes(Request $request): void
    {
        $types = Database::fetchAll("SELECT * FROM service_types WHERE active = 1 ORDER BY name ASC");
        if (empty($types)) {
            $default = [
                ['id' => 'srv_1', 'name' => 'Consulta Geral', 'price' => 250.00, 'duration_minutes' => 30],
                ['id' => 'srv_2', 'name' => 'Primeira Consulta Especialista', 'price' => 350.00, 'duration_minutes' => 45],
                ['id' => 'srv_3', 'name' => 'Retorno', 'price' => 0.00, 'duration_minutes' => 20],
                ['id' => 'srv_4', 'name' => 'Exame Clínico Detalhado', 'price' => 180.00, 'duration_minutes' => 30],
            ];
            foreach ($default as $st) {
                Database::insert('service_types', array_merge($st, ['active' => 1]));
            }
            $types = Database::fetchAll("SELECT * FROM service_types WHERE active = 1 ORDER BY name ASC");
        }

        foreach ($types as &$st) {
            $st['price'] = (float) $st['price'];
        }

        Response::success($types);
    }

    public function cases(Request $request): void
    {
        $cases = Database::fetchAll("SELECT * FROM cases ORDER BY created_at DESC");
        Response::success($cases);
    }
}
