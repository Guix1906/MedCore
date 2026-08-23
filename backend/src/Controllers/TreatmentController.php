<?php

namespace App\Controllers;

use App\Core\Request;
use App\Core\Response;
use App\Core\Database;

class TreatmentController
{
    public function index(Request $request): void
    {
        $patientId = $request->query('patient_id');
        $status = $request->query('status');

        $sql = "
            SELECT t.*, 
                   p.name as patient_name,
                   d.name as doctor_name
            FROM treatments t
            JOIN patients p ON p.id = t.patient_id
            LEFT JOIN doctors d ON d.id = t.doctor_id
            WHERE 1=1
        ";
        $params = [];

        if (!empty($patientId)) {
            $sql .= " AND t.patient_id = :patient_id";
            $params['patient_id'] = $patientId;
        }

        if (!empty($status)) {
            $sql .= " AND t.status = :status";
            $params['status'] = $status;
        }

        $sql .= " ORDER BY t.created_at DESC";

        $treatments = Database::fetchAll($sql, $params);

        foreach ($treatments as &$t) {
            $t['total_value'] = (float) $t['total_value'];
            $t['number_of_installments'] = (int) $t['number_of_installments'];
        }

        Response::success($treatments);
    }

    public function show(Request $request, array $params): void
    {
        $id = $params['id'] ?? '';
        $treatment = Database::fetchOne("
            SELECT t.*, p.name as patient_name, d.name as doctor_name
            FROM treatments t
            JOIN patients p ON p.id = t.patient_id
            LEFT JOIN doctors d ON d.id = t.doctor_id
            WHERE t.id = :id
        ", ['id' => $id]);

        if (!$treatment) {
            Response::notFound('Tratamento não encontrado');
        }

        $treatment['total_value'] = (float) $treatment['total_value'];
        $treatment['number_of_installments'] = (int) $treatment['number_of_installments'];

        $medications = Database::fetchAll("SELECT * FROM treatment_medications WHERE treatment_id = :id ORDER BY created_at ASC", ['id' => $id]);
        $installments = Database::fetchAll("SELECT * FROM treatment_installments WHERE treatment_id = :id ORDER BY number ASC", ['id' => $id]);

        foreach ($installments as &$inst) {
            $inst['amount'] = (float) $inst['amount'];
            $inst['paid_amount'] = $inst['paid_amount'] !== null ? (float) $inst['paid_amount'] : null;
        }

        $treatment['medications'] = $medications;
        $treatment['installments'] = $installments;

        Response::success($treatment);
    }

    public function store(Request $request): void
    {
        $patientId = $request->input('patient_id', $request->input('patientId'));
        $title = trim($request->input('title', ''));
        $startDate = $request->input('start_date', $request->input('startDate', date('Y-m-d')));

        if (empty($patientId) || empty($title)) {
            Response::error('Paciente e título do tratamento são obrigatórios', 422);
        }

        $id = $request->input('id') ?: 'trt_' . substr(bin2hex(random_bytes(8)), 0, 16);
        $companyId = $request->getCompanyId();
        $totalValue = (float) $request->input('total_value', $request->input('totalValue', 0));
        $numInstallments = max(1, (int) $request->input('number_of_installments', $request->input('numberOfInstallments', 1)));

        Database::beginTransaction();
        try {
            Database::insert('treatments', [
                'id' => $id,
                'company_id' => $companyId,
                'patient_id' => $patientId,
                'doctor_id' => $request->input('doctor_id'),
                'title' => $title,
                'description' => $request->input('description'),
                'start_date' => $startDate,
                'end_date' => $request->input('end_date'),
                'status' => $request->input('status', 'in_progress'),
                'total_value' => $totalValue,
                'number_of_installments' => $numInstallments,
            ]);

            // Gerar parcelas automaticamente
            if ($totalValue > 0) {
                $installmentAmount = round($totalValue / $numInstallments, 2);
                $diff = round($totalValue - ($installmentAmount * $numInstallments), 2);

                for ($i = 1; $i <= $numInstallments; $i++) {
                    $amount = $i === 1 ? ($installmentAmount + $diff) : $installmentAmount;
                    $dueDate = date('Y-m-d', strtotime("+{$i} month", strtotime($startDate)));

                    Database::insert('treatment_installments', [
                        'id' => 'ins_' . substr(bin2hex(random_bytes(6)), 0, 12),
                        'treatment_id' => $id,
                        'number' => $i,
                        'due_date' => $dueDate,
                        'amount' => $amount,
                        'status' => 'pending',
                    ]);
                }
            }

            Database::commit();

            $created = Database::fetchOne("SELECT * FROM treatments WHERE id = :id", ['id' => $id]);
            Response::success($created, 'Tratamento criado com sucesso', 201);
        } catch (\Throwable $e) {
            Database::rollback();
            Response::error('Erro ao salvar tratamento: ' . $e->getMessage(), 500);
        }
    }

    public function update(Request $request, array $params): void
    {
        $id = $params['id'] ?? '';
        $fields = ['title', 'description', 'start_date', 'end_date', 'status', 'total_value', 'doctor_id'];
        $updateData = [];

        foreach ($fields as $field) {
            $val = $request->input($field);
            if ($val !== null) {
                $updateData[$field] = $field === 'total_value' ? (float) $val : $val;
            }
        }

        if (!empty($updateData)) {
            $updateData['updated_at'] = date('Y-m-d H:i:s');
            Database::update('treatments', $updateData, 'id = :id', ['id' => $id]);
        }

        $treatment = Database::fetchOne("SELECT * FROM treatments WHERE id = :id", ['id' => $id]);
        Response::success($treatment, 'Tratamento atualizado');
    }

    public function destroy(Request $request, array $params): void
    {
        $id = $params['id'] ?? '';
        Database::delete('treatments', 'id = :id', ['id' => $id]);
        Response::success(null, 'Tratamento excluído');
    }

    // Medicamentos do tratamento
    public function storeMedication(Request $request, array $params): void
    {
        $treatmentId = $params['id'] ?? $request->input('treatment_id');
        $name = trim($request->input('name', ''));
        if (empty($name)) {
            Response::error('Nome do medicamento é obrigatório', 422);
        }

        $id = 'trm_' . substr(bin2hex(random_bytes(6)), 0, 12);
        Database::insert('treatment_medications', [
            'id' => $id,
            'treatment_id' => $treatmentId,
            'name' => $name,
            'dosage' => $request->input('dosage'),
            'frequency' => $request->input('frequency'),
            'duration' => $request->input('duration'),
            'instructions' => $request->input('instructions'),
            'status' => $request->input('status', 'active'),
        ]);

        $med = Database::fetchOne("SELECT * FROM treatment_medications WHERE id = :id", ['id' => $id]);
        Response::success($med, 'Medicamento adicionado', 201);
    }

    public function updateMedication(Request $request, array $params): void
    {
        $id = $params['medicationId'] ?? $params['id'] ?? '';
        $fields = ['name', 'dosage', 'frequency', 'duration', 'instructions', 'status'];
        $updateData = [];

        foreach ($fields as $field) {
            $val = $request->input($field);
            if ($val !== null) {
                $updateData[$field] = $val;
            }
        }

        if (!empty($updateData)) {
            $updateData['updated_at'] = date('Y-m-d H:i:s');
            Database::update('treatment_medications', $updateData, 'id = :id', ['id' => $id]);
        }

        $med = Database::fetchOne("SELECT * FROM treatment_medications WHERE id = :id", ['id' => $id]);
        Response::success($med, 'Medicamento atualizado');
    }

    public function deleteMedication(Request $request, array $params): void
    {
        $id = $params['medicationId'] ?? $params['id'] ?? '';
        Database::delete('treatment_medications', 'id = :id', ['id' => $id]);
        Response::success(null, 'Medicamento removido');
    }
}
