<?php

namespace App\Controllers;

use App\Core\Request;
use App\Core\Response;
use App\Core\Database;

class PatientController extends BaseController
{
    public function index(Request $request): void
    {
        $companyId = $this->getTenantCompanyId($request);
        $q = trim((string) $request->query('q', ''));
        $active = $request->query('active');
        $limit = max(1, min(500, (int) $request->query('limit', 500)));

        $sql = "SELECT id, name, email, phone, cpf, birth_date, gender, insurance, insurance_number, address, city, state, zip_code, emergency_contact_name, emergency_contact_phone, notes, active, created_at, updated_at FROM patients WHERE company_id = :company_id";
        $params = ['company_id' => $companyId];

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

        $sql .= " ORDER BY name ASC LIMIT :limit";
        $params['limit'] = $limit;

        $patients = Database::fetchAll($sql, $params);

        // Formatar campo booleano
        foreach ($patients as &$p) {
            $p['active'] = (bool) $p['active'];
        }

        Response::success($patients);
    }

    public function show(Request $request, array $params): void
    {
        $companyId = $this->getTenantCompanyId($request);
        $id = $params['id'] ?? '';
        $patient = $this->findTenantResource('patients', $id, $companyId, 'Paciente');

        $patient['active'] = (bool) $patient['active'];

        // Buscar histórico de consultas e prontuários pertencentes ao tenant
        $appointments = Database::fetchAll("
            SELECT a.*, d.name as doctor_name 
            FROM appointments a 
            LEFT JOIN doctors d ON d.id = a.doctor_id 
            WHERE a.patient_id = :id AND (a.company_id = :cid OR a.company_id IS NULL)
            ORDER BY a.date DESC, a.start_time DESC
        ", ['id' => $id, 'cid' => $companyId]);

        $records = Database::fetchAll("
            SELECT r.*, d.name as doctor_name 
            FROM medical_records r 
            LEFT JOIN doctors d ON d.id = r.doctor_id 
            WHERE r.patient_id = :id AND (r.company_id = :cid OR r.company_id IS NULL)
            ORDER BY r.created_at DESC
        ", ['id' => $id, 'cid' => $companyId]);

        $patient['appointments'] = $appointments;
        $patient['medical_records'] = $records;

        Response::success($patient);
    }

    public function store(Request $request): void
    {
        $companyId = $this->getTenantCompanyId($request);
        $name = trim($request->input('name', ''));
        if (empty($name)) {
            Response::error('Nome do paciente é obrigatório', 422);
        }

        $cpf = $request->input('cpf');
        if (!empty($cpf) && !$this->isValidCpf($cpf)) {
            Response::error('O CPF informado é inválido.', 422);
        }

        $id = $request->input('id') ?: 'pat_' . substr(bin2hex(random_bytes(8)), 0, 16);

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

        // Registrar log de atividade com escopo
        Database::execute("INSERT INTO activity_logs (id, company_id, user_id, entity_type, entity_id, entity_label, action, metadata) VALUES (:id, :cid, :uid, 'patient', :eid, :elabel, 'create', :meta)", [
            'id' => 'act_' . substr(bin2hex(random_bytes(6)), 0, 12),
            'cid' => $companyId,
            'uid' => $request->getUserId(),
            'eid' => $id,
            'elabel' => $name,
            'meta' => json_encode(['name' => $name])
        ]);

        $created = $this->findTenantResource('patients', $id, $companyId, 'Paciente');
        $created['active'] = (bool) $created['active'];

        Response::success($created, 'Paciente cadastrado com sucesso', 201);
    }

    public function update(Request $request, array $params): void
    {
        $companyId = $this->getTenantCompanyId($request);
        $id = $params['id'] ?? '';
        $this->findTenantResource('patients', $id, $companyId, 'Paciente');

        $cpf = $request->input('cpf');
        if ($cpf !== null && trim($cpf) !== '' && !$this->isValidCpf($cpf)) {
            Response::error('O CPF informado é inválido.', 422);
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
            Database::update('patients', $updateData, 'id = :id AND company_id = :cid', ['id' => $id, 'cid' => $companyId]);
        }

        $updated = $this->findTenantResource('patients', $id, $companyId, 'Paciente');
        $updated['active'] = (bool) $updated['active'];

        Response::success($updated, 'Paciente atualizado com sucesso');
    }

    public function destroy(Request $request, array $params): void
    {
        $companyId = $this->getTenantCompanyId($request);
        $id = $params['id'] ?? '';
        $this->deleteTenantResource('patients', $id, $companyId, 'Paciente');

        Response::success(null, 'Paciente excluído com sucesso');
    }

    /**
     * Valida um número de CPF pelo algoritmo oficial dos dígitos verificadores (módulo 11).
     */
    private function isValidCpf(?string $cpf): bool
    {
        if ($cpf === null || trim($cpf) === '') {
            return true;
        }

        $clean = preg_replace('/\D/', '', $cpf);
        if (strlen($clean) !== 11) {
            return false;
        }

        // Rejeita sequências conhecidas de dígitos iguais
        if (preg_match('/^(\d)\1{10}$/', $clean)) {
            return false;
        }

        // Validação dos dois dígitos verificadores
        for ($t = 9; $t < 11; $t++) {
            $d = 0;
            for ($c = 0; $c < $t; $c++) {
                $d += (int)$clean[$c] * (($t + 1) - $c);
            }
            $d = ((10 * $d) % 11) % 10;
            if ((int)$clean[$t] !== $d) {
                return false;
            }
        }

        return true;
    }
}
