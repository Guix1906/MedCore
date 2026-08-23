<?php

namespace App\Controllers;

use App\Core\Request;
use App\Core\Response;
use App\Core\Database;

class PatientController
{
    public function index(Request $request): void
    {
        $q = trim($request->query('q', ''));
        $active = $request->query('active');
        $limit = (int) $request->query('limit', 500);
        if ($limit <= 0 || $limit > 2000) {
            $limit = 500;
        }

        $sql = "SELECT id, name, email, phone, cpf, birth_date, gender, insurance, insurance_number, address, city, state, zip_code, emergency_contact_name, emergency_contact_phone, notes, active, created_at, updated_at FROM patients WHERE 1=1";
        $params = [];

        if (!empty($q)) {
            $sql .= " AND (name LIKE :q_name OR email LIKE :q_email OR phone LIKE :q_phone OR cpf LIKE :q_cpf)";
            $searchTerm = "%{$q}%";
            $params['q_name'] = $searchTerm;
            $params['q_email'] = $searchTerm;
            $params['q_phone'] = $searchTerm;
            $params['q_cpf'] = $searchTerm;
        }

        if ($active !== null && $active !== '') {
            $sql .= " AND active = :active";
            $params['active'] = $active ? 1 : 0;
        }

        $sql .= " ORDER BY name ASC LIMIT {$limit}";

        $patients = Database::fetchAll($sql, $params);

        // Formatar campo booleano
        foreach ($patients as &$p) {
            $p['active'] = (bool) $p['active'];
        }

        Response::success($patients);
    }

    public function show(Request $request, array $params): void
    {
        $id = $params['id'] ?? '';
        $patient = Database::fetchOne("SELECT * FROM patients WHERE id = :id", ['id' => $id]);

        if (!$patient) {
            Response::notFound('Paciente não encontrado');
        }

        $patient['active'] = (bool) $patient['active'];

        // Buscar histórico de consultas e prontuários
        $appointments = Database::fetchAll("
            SELECT a.*, d.name as doctor_name 
            FROM appointments a 
            LEFT JOIN doctors d ON d.id = a.doctor_id 
            WHERE a.patient_id = :id 
            ORDER BY a.date DESC, a.start_time DESC
        ", ['id' => $id]);

        $records = Database::fetchAll("
            SELECT r.*, d.name as doctor_name 
            FROM medical_records r 
            LEFT JOIN doctors d ON d.id = r.doctor_id 
            WHERE r.patient_id = :id 
            ORDER BY r.created_at DESC
        ", ['id' => $id]);

        $patient['appointments'] = $appointments;
        $patient['medical_records'] = $records;

        Response::success($patient);
    }

    public function store(Request $request): void
    {
        $name = trim($request->input('name', ''));
        if (empty($name)) {
            Response::error('Nome do paciente é obrigatório', 422);
        }

        $id = $request->input('id') ?: 'pat_' . substr(bin2hex(random_bytes(8)), 0, 16);
        $companyId = $request->getCompanyId();

        $data = [
            'id' => $id,
            'company_id' => $companyId,
            'name' => $name,
            'email' => $request->input('email'),
            'phone' => $request->input('phone'),
            'cpf' => $request->input('cpf'),
            'birth_date' => $request->input('birth_date') ?: $request->input('birthDate'),
            'gender' => $request->input('gender'),
            'blood_type' => $request->input('blood_type') ?: $request->input('bloodType'),
            'insurance' => $request->input('insurance', 'Particular'),
            'insurance_number' => $request->input('insurance_number') ?: $request->input('insuranceNumber'),
            'address' => $request->input('address'),
            'city' => $request->input('city'),
            'state' => $request->input('state'),
            'zip_code' => $request->input('zip_code') ?: $request->input('zipCode'),
            'emergency_contact_name' => $request->input('emergency_contact_name') ?: $request->input('emergencyContactName'),
            'emergency_contact_phone' => $request->input('emergency_contact_phone') ?: $request->input('emergencyContactPhone'),
            'notes' => $request->input('notes'),
            'active' => $request->input('active', 1) ? 1 : 0,
        ];

        Database::insert('patients', $data);

        // Registrar log de atividade
        Database::execute("INSERT INTO activity_logs (id, company_id, user_id, entity_type, entity_id, entity_label, action, metadata) VALUES (:id, :cid, :uid, 'patient', :eid, :elabel, 'create', :meta)", [
            'id' => 'act_' . substr(bin2hex(random_bytes(6)), 0, 12),
            'cid' => $companyId,
            'uid' => $request->getUserId(),
            'eid' => $id,
            'elabel' => $name,
            'meta' => json_encode(['name' => $name])
        ]);

        $created = Database::fetchOne("SELECT * FROM patients WHERE id = :id", ['id' => $id]);
        $created['active'] = (bool) $created['active'];

        Response::success($created, 'Paciente cadastrado com sucesso', 201);
    }

    public function update(Request $request, array $params): void
    {
        $id = $params['id'] ?? '';
        $existing = Database::fetchOne("SELECT * FROM patients WHERE id = :id", ['id' => $id]);

        if (!$existing) {
            Response::notFound('Paciente não encontrado');
        }

        $fields = [
            'name', 'email', 'phone', 'cpf', 'birth_date', 'gender', 'blood_type',
            'insurance', 'insurance_number', 'address', 'city', 'state', 'zip_code',
            'emergency_contact_name', 'emergency_contact_phone', 'notes', 'active'
        ];

        $updateData = [];
        foreach ($fields as $field) {
            $inputVal = $request->input($field);
            if ($inputVal !== null) {
                if ($field === 'active') {
                    $updateData[$field] = $inputVal ? 1 : 0;
                } else {
                    $updateData[$field] = $inputVal;
                }
            }
        }

        if (!empty($updateData)) {
            $updateData['updated_at'] = date('Y-m-d H:i:s');
            Database::update('patients', $updateData, 'id = :id', ['id' => $id]);
        }

        $updated = Database::fetchOne("SELECT * FROM patients WHERE id = :id", ['id' => $id]);
        $updated['active'] = (bool) $updated['active'];

        Response::success($updated, 'Paciente atualizado com sucesso');
    }

    public function destroy(Request $request, array $params): void
    {
        $id = $params['id'] ?? '';
        $existing = Database::fetchOne("SELECT * FROM patients WHERE id = :id", ['id' => $id]);

        if (!$existing) {
            Response::notFound('Paciente não encontrado');
        }

        Database::delete('patients', 'id = :id', ['id' => $id]);

        Response::success(null, 'Paciente excluído com sucesso');
    }
}
