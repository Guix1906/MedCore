<?php

namespace App\Controllers;

use App\Core\Request;
use App\Core\Response;
use App\Core\Database;

class DoctorController
{
    public function index(Request $request): void
    {
        $doctors = Database::fetchAll("
            SELECT id, name, email, specialty, crm, role, avatar_url, active, created_at 
            FROM doctors 
            WHERE active = 1 
            ORDER BY name ASC
        ");

        // Se ainda não houver médicos semeados, semear dados iniciais
        if (empty($doctors)) {
            $defaultDoctors = [
                ['id' => 'doc_1', 'name' => 'Dr. Carlos Eduardo Menezes', 'email' => 'carlos.menezes@clinicmed.com', 'specialty' => 'Cardiologia', 'crm' => 'CRM/SP 142.890', 'role' => 'medico'],
                ['id' => 'doc_2', 'name' => 'Dra. Mariana Vasconcelos', 'email' => 'mariana.vasconcelos@clinicmed.com', 'specialty' => 'Dermatologia', 'crm' => 'CRM/SP 198.345', 'role' => 'medico'],
                ['id' => 'doc_3', 'name' => 'Dr. Roberto Silveira', 'email' => 'roberto.silveira@clinicmed.com', 'specialty' => 'Ortopedia', 'crm' => 'CRM/SP 115.678', 'role' => 'medico'],
                ['id' => 'doc_4', 'name' => 'Dra. Beatriz Albuquerque', 'email' => 'beatriz.albuquerque@clinicmed.com', 'specialty' => 'Ginecologia', 'crm' => 'CRM/SP 173.210', 'role' => 'medico'],
            ];

            foreach ($defaultDoctors as $doc) {
                Database::insert('doctors', array_merge($doc, ['active' => 1]));
            }

            $doctors = Database::fetchAll("SELECT id, name, email, specialty, crm, role, avatar_url, active, created_at FROM doctors WHERE active = 1 ORDER BY name ASC");
        }

        foreach ($doctors as &$d) {
            $d['active'] = (bool) $d['active'];
        }

        Response::success($doctors);
    }

    public function show(Request $request, array $params): void
    {
        $id = $params['id'] ?? '';
        $doctor = Database::fetchOne("SELECT * FROM doctors WHERE id = :id", ['id' => $id]);

        if (!$doctor) {
            Response::notFound('Médico não encontrado');
        }

        $doctor['active'] = (bool) $doctor['active'];
        Response::success($doctor);
    }
}
