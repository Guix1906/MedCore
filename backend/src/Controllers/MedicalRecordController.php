<?php

namespace App\Controllers;

use App\Core\Request;
use App\Core\Response;
use App\Core\Database;

class MedicalRecordController
{
    public function index(Request $request): void
    {
        $patientId = $request->query('patient_id');
        $sql = "
            SELECT r.*, d.name as doctor_name, p.name as patient_name
            FROM medical_records r
            LEFT JOIN doctors d ON d.id = r.doctor_id
            LEFT JOIN patients p ON p.id = r.patient_id
            WHERE 1=1
        ";
        $params = [];

        if (!empty($patientId)) {
            $sql .= " AND r.patient_id = :patient_id";
            $params['patient_id'] = $patientId;
        }

        $sql .= " ORDER BY r.created_at DESC";

        $records = Database::fetchAll($sql, $params);
        Response::success($records);
    }

    public function show(Request $request, array $params): void
    {
        $id = $params['id'] ?? '';
        $record = Database::fetchOne("
            SELECT r.*, d.name as doctor_name, p.name as patient_name
            FROM medical_records r
            LEFT JOIN doctors d ON d.id = r.doctor_id
            LEFT JOIN patients p ON p.id = r.patient_id
            WHERE r.id = :id
        ", ['id' => $id]);

        if (!$record) {
            Response::notFound('Prontuário não encontrado');
        }

        $prescriptions = Database::fetchAll("SELECT * FROM prescriptions WHERE medical_record_id = :id", ['id' => $id]);
        $record['prescriptions'] = $prescriptions;

        Response::success($record);
    }

    public function store(Request $request): void
    {
        $patientId = $request->input('patient_id', $request->input('patientId'));
        if (empty($patientId)) {
            Response::error('ID do paciente é obrigatório', 422);
        }

        $id = $request->input('id') ?: 'rec_' . substr(bin2hex(random_bytes(8)), 0, 16);
        $companyId = $request->getCompanyId();

        $data = [
            'id' => $id,
            'company_id' => $companyId,
            'patient_id' => $patientId,
            'doctor_id' => $request->input('doctor_id'),
            'appointment_id' => $request->input('appointment_id'),
            'clinical_history' => $request->input('clinical_history'),
            'surgical_history' => $request->input('surgical_history'),
            'family_history' => $request->input('family_history'),
            'habits' => $request->input('habits'),
            'allergies' => $request->input('allergies'),
            'complaint' => $request->input('complaint'),
            'evolution' => $request->input('evolution'),
            'diagnosis' => $request->input('diagnosis'),
            'diagnosis_code' => $request->input('diagnosis_code'),
            'conduct' => $request->input('conduct'),
            'return_date' => $request->input('return_date'),
            'return_notes' => $request->input('return_notes'),
            'started_at' => $request->input('started_at'),
            'finished_at' => $request->input('finished_at'),
            'duration_seconds' => $request->input('duration_seconds'),
        ];

        Database::insert('medical_records', $data);

        // Se houver prescrições enviadas juntas
        $prescriptions = $request->input('prescriptions', []);
        if (is_array($prescriptions)) {
            foreach ($prescriptions as $p) {
                if (!empty($p['medication'])) {
                    Database::insert('prescriptions', [
                        'id' => 'psc_' . substr(bin2hex(random_bytes(6)), 0, 12),
                        'medical_record_id' => $id,
                        'patient_id' => $patientId,
                        'doctor_id' => $request->input('doctor_id'),
                        'medication' => $p['medication'],
                        'dosage' => $p['dosage'] ?? null,
                        'frequency' => $p['frequency'] ?? null,
                        'duration' => $p['duration'] ?? null,
                        'instructions' => $p['instructions'] ?? null,
                    ]);
                }
            }
        }

        $record = Database::fetchOne("SELECT * FROM medical_records WHERE id = :id", ['id' => $id]);
        Response::success($record, 'Prontuário salvo com sucesso', 201);
    }
}
