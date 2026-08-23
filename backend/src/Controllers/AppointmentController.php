<?php

namespace App\Controllers;

use App\Core\Request;
use App\Core\Response;
use App\Core\Database;

class AppointmentController
{
    public function index(Request $request): void
    {
        $date = $request->query('date');
        $startDate = $request->query('start_date');
        $endDate = $request->query('end_date');
        $doctorId = $request->query('doctor_id');
        $patientId = $request->query('patient_id');
        $status = $request->query('status');

        $sql = "
            SELECT a.*, 
                   p.name as patient_name, p.phone as patient_phone, p.cpf as patient_cpf,
                   d.name as doctor_name, d.specialty as doctor_specialty
            FROM appointments a
            JOIN patients p ON p.id = a.patient_id
            JOIN doctors d ON d.id = a.doctor_id
            WHERE 1=1
        ";
        $params = [];

        if (!empty($date)) {
            $sql .= " AND a.date = :date";
            $params['date'] = $date;
        }

        if (!empty($startDate) && !empty($endDate)) {
            $sql .= " AND a.date BETWEEN :start_date AND :end_date";
            $params['start_date'] = $startDate;
            $params['end_date'] = $endDate;
        }

        if (!empty($doctorId)) {
            $sql .= " AND a.doctor_id = :doctor_id";
            $params['doctor_id'] = $doctorId;
        }

        if (!empty($patientId)) {
            $sql .= " AND a.patient_id = :patient_id";
            $params['patient_id'] = $patientId;
        }

        if (!empty($status)) {
            $sql .= " AND a.status = :status";
            $params['status'] = $status;
        }

        $sql .= " ORDER BY a.date ASC, a.start_time ASC";

        $appointments = Database::fetchAll($sql, $params);

        foreach ($appointments as &$a) {
            $a['online'] = (bool) $a['online'];
            $a['amount'] = $a['amount'] !== null ? (float) $a['amount'] : null;
        }

        Response::success($appointments);
    }

    public function store(Request $request): void
    {
        $patientId = $request->input('patient_id', $request->input('patientId'));
        $doctorId = $request->input('doctor_id', $request->input('doctorId'));
        $date = $request->input('date');
        $startTime = $request->input('start_time', $request->input('startTime'));
        $endTime = $request->input('end_time', $request->input('endTime'));

        if (empty($patientId) || empty($doctorId) || empty($date) || empty($startTime) || empty($endTime)) {
            Response::error('Paciente, médico, data e horários de início/fim são obrigatórios', 422);
        }

        $id = $request->input('id') ?: 'apt_' . substr(bin2hex(random_bytes(8)), 0, 16);
        $companyId = $request->getCompanyId();

        $data = [
            'id' => $id,
            'company_id' => $companyId,
            'patient_id' => $patientId,
            'doctor_id' => $doctorId,
            'date' => $date,
            'start_time' => $startTime,
            'end_time' => $endTime,
            'type' => $request->input('type', 'consulta'),
            'status' => $request->input('status', 'agendado'),
            'notes' => $request->input('notes'),
            'insurance' => $request->input('insurance', 'Particular'),
            'amount' => $request->input('amount') !== null ? (float) $request->input('amount') : null,
            'online' => $request->input('online', 0) ? 1 : 0,
        ];

        Database::insert('appointments', $data);

        // Se houver transação financeira associada
        $sinalAmount = $request->input('sinal_amount');
        if ($sinalAmount && (float) $sinalAmount > 0) {
            Database::insert('transactions', [
                'id' => 'tx_' . substr(bin2hex(random_bytes(6)), 0, 12),
                'company_id' => $companyId,
                'patient_id' => $patientId,
                'doctor_id' => $doctorId,
                'appointment_id' => $id,
                'type' => 'income',
                'description' => 'Sinal de consulta - Agendamento #' . substr($id, -6),
                'amount' => (float) $sinalAmount,
                'date' => $date,
                'status' => 'completed',
                'payment_method' => $request->input('payment_method', 'PIX'),
            ]);
        }

        $appointment = Database::fetchOne("
            SELECT a.*, p.name as patient_name, d.name as doctor_name 
            FROM appointments a
            JOIN patients p ON p.id = a.patient_id
            JOIN doctors d ON d.id = a.doctor_id
            WHERE a.id = :id
        ", ['id' => $id]);

        Response::success($appointment, 'Consulta agendada com sucesso', 201);
    }

    public function update(Request $request, array $params): void
    {
        $id = $params['id'] ?? '';
        $existing = Database::fetchOne("SELECT * FROM appointments WHERE id = :id", ['id' => $id]);

        if (!$existing) {
            Response::notFound('Consulta não encontrada');
        }

        $fields = ['patient_id', 'doctor_id', 'date', 'start_time', 'end_time', 'type', 'status', 'notes', 'insurance', 'amount', 'online'];
        $updateData = [];

        foreach ($fields as $field) {
            $val = $request->input($field);
            if ($val !== null) {
                if ($field === 'online') {
                    $updateData[$field] = $val ? 1 : 0;
                } elseif ($field === 'amount') {
                    $updateData[$field] = (float) $val;
                } else {
                    $updateData[$field] = $val;
                }
            }
        }

        if (!empty($updateData)) {
            $updateData['updated_at'] = date('Y-m-d H:i:s');
            Database::update('appointments', $updateData, 'id = :id', ['id' => $id]);
        }

        $updated = Database::fetchOne("
            SELECT a.*, p.name as patient_name, d.name as doctor_name 
            FROM appointments a
            JOIN patients p ON p.id = a.patient_id
            JOIN doctors d ON d.id = a.doctor_id
            WHERE a.id = :id
        ", ['id' => $id]);

        Response::success($updated, 'Agendamento atualizado com sucesso');
    }

    public function destroy(Request $request, array $params): void
    {
        $id = $params['id'] ?? '';
        Database::delete('appointments', 'id = :id', ['id' => $id]);
        Response::success(null, 'Consulta desmarcada com sucesso');
    }
}
