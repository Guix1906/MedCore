<?php

namespace App\Controllers;

use App\Core\Request;
use App\Core\Response;
use App\Core\Database;

class AgendaController extends BaseController
{
    // Tasks
    public function tasks(Request $request): void
    {
        $companyId = $this->getTenantCompanyId($request);
        $tasks = Database::fetchAll("SELECT * FROM tasks WHERE company_id = :cid ORDER BY due_date ASC, created_at DESC", [
            'cid' => $companyId
        ]);
        Response::success($tasks);
    }

    public function storeTask(Request $request): void
    {
        $companyId = $this->getTenantCompanyId($request);
        $title = trim($request->input('title', ''));
        if (empty($title)) {
            Response::error('Título da tarefa é obrigatório', 422);
        }

        $id = $request->input('id') ?: 'tsk_' . substr(bin2hex(random_bytes(8)), 0, 16);

        Database::insert('tasks', [
            'id' => $id,
            'company_id' => $companyId,
            'user_id' => $request->getUserId(),
            'assigned_to' => $request->input('assigned_to'),
            'title' => $title,
            'description' => $request->input('description'),
            'due_date' => $request->input('due_date'),
            'due_time' => $request->input('due_time'),
            'priority' => $request->input('priority', 'medium'),
            'status' => $request->input('status', 'todo'),
            'category' => $request->input('category'),
        ]);

        $task = $this->findTenantResource('tasks', $id, $companyId, 'Tarefa');
        Response::success($task, 'Tarefa criada com sucesso', 201);
    }

    public function updateTask(Request $request, array $params): void
    {
        $companyId = $this->getTenantCompanyId($request);
        $id = $params['id'] ?? '';
        $this->findTenantResource('tasks', $id, $companyId, 'Tarefa');

        $fields = ['title', 'description', 'due_date', 'due_time', 'priority', 'status', 'category', 'assigned_to'];
        $updateData = [];

        foreach ($fields as $field) {
            $val = $request->input($field);
            if ($val !== null) {
                $updateData[$field] = $val;
            }
        }

        if (!empty($updateData)) {
            $updateData['updated_at'] = date('Y-m-d H:i:s');
            Database::update('tasks', $updateData, 'id = :id AND company_id = :cid', ['id' => $id, 'cid' => $companyId]);
        }

        $task = $this->findTenantResource('tasks', $id, $companyId, 'Tarefa');
        Response::success($task, 'Tarefa atualizada');
    }

    public function deleteTask(Request $request, array $params): void
    {
        $companyId = $this->getTenantCompanyId($request);
        $id = $params['id'] ?? '';
        $this->deleteTenantResource('tasks', $id, $companyId, 'Tarefa');
        Response::success(null, 'Tarefa excluída');
    }

    // Events
    public function events(Request $request): void
    {
        $companyId = $this->getTenantCompanyId($request);
        $events = Database::fetchAll("SELECT * FROM events WHERE company_id = :cid ORDER BY start_time ASC", [
            'cid' => $companyId
        ]);
        Response::success($events);
    }

    public function storeEvent(Request $request): void
    {
        $companyId = $this->getTenantCompanyId($request);
        $title = trim($request->input('title', ''));
        $startTime = $request->input('start_time');
        if (empty($title) || empty($startTime)) {
            Response::error('Título e horário de início são obrigatórios', 422);
        }

        $id = $request->input('id') ?: 'evt_' . substr(bin2hex(random_bytes(8)), 0, 16);

        Database::insert('events', [
            'id' => $id,
            'company_id' => $companyId,
            'user_id' => $request->getUserId(),
            'patient_id' => $request->input('patient_id'),
            'doctor_id' => $request->input('doctor_id'),
            'title' => $title,
            'description' => $request->input('description'),
            'start_time' => $startTime,
            'end_time' => $request->input('end_time'),
            'event_type' => $request->input('event_type', 'appointment'),
            'status' => $request->input('status', 'scheduled'),
            'location' => $request->input('location'),
            'notes' => $request->input('notes'),
        ]);

        $event = $this->findTenantResource('events', $id, $companyId, 'Evento');
        Response::success($event, 'Evento criado', 201);
    }

    public function updateEvent(Request $request, array $params): void
    {
        $companyId = $this->getTenantCompanyId($request);
        $id = $params['id'] ?? '';
        $this->findTenantResource('events', $id, $companyId, 'Evento');

        $fields = ['title', 'description', 'start_time', 'end_time', 'event_type', 'status', 'location', 'notes'];
        $updateData = [];

        foreach ($fields as $field) {
            $val = $request->input($field);
            if ($val !== null) {
                $updateData[$field] = $val;
            }
        }

        if (!empty($updateData)) {
            $updateData['updated_at'] = date('Y-m-d H:i:s');
            Database::update('events', $updateData, 'id = :id AND company_id = :cid', ['id' => $id, 'cid' => $companyId]);
        }

        $event = $this->findTenantResource('events', $id, $companyId, 'Evento');
        Response::success($event, 'Evento atualizado');
    }

    public function deleteEvent(Request $request, array $params): void
    {
        $companyId = $this->getTenantCompanyId($request);
        $id = $params['id'] ?? '';
        $this->deleteTenantResource('events', $id, $companyId, 'Evento');
        Response::success(null, 'Evento excluído');
    }

    // Deadlines
    public function deadlines(Request $request): void
    {
        $companyId = $this->getTenantCompanyId($request);
        $deadlines = Database::fetchAll("SELECT * FROM deadlines WHERE company_id = :cid ORDER BY due_date ASC", [
            'cid' => $companyId
        ]);
        Response::success($deadlines);
    }

    public function storeDeadline(Request $request): void
    {
        $companyId = $this->getTenantCompanyId($request);
        $title = trim($request->input('title', ''));
        $dueDate = $request->input('due_date');
        if (empty($title) || empty($dueDate)) {
            Response::error('Título e data limite são obrigatórios', 422);
        }

        $id = $request->input('id') ?: 'ddl_' . substr(bin2hex(random_bytes(8)), 0, 16);

        Database::insert('deadlines', [
            'id' => $id,
            'company_id' => $companyId,
            'user_id' => $request->getUserId(),
            'title' => $title,
            'description' => $request->input('description'),
            'due_date' => $dueDate,
            'priority' => $request->input('priority', 'medium'),
            'status' => $request->input('status', 'pending'),
        ]);

        $deadline = $this->findTenantResource('deadlines', $id, $companyId, 'Prazo');
        Response::success($deadline, 'Prazo criado', 201);
    }

    public function updateDeadline(Request $request, array $params): void
    {
        $companyId = $this->getTenantCompanyId($request);
        $id = $params['id'] ?? '';
        $this->findTenantResource('deadlines', $id, $companyId, 'Prazo');

        $fields = ['title', 'description', 'due_date', 'priority', 'status'];
        $updateData = [];

        foreach ($fields as $field) {
            $val = $request->input($field);
            if ($val !== null) {
                $updateData[$field] = $val;
            }
        }

        if (!empty($updateData)) {
            $updateData['updated_at'] = date('Y-m-d H:i:s');
            Database::update('deadlines', $updateData, 'id = :id AND company_id = :cid', ['id' => $id, 'cid' => $companyId]);
        }

        $deadline = $this->findTenantResource('deadlines', $id, $companyId, 'Prazo');
        Response::success($deadline, 'Prazo atualizado');
    }

    public function deleteDeadline(Request $request, array $params): void
    {
        $companyId = $this->getTenantCompanyId($request);
        $id = $params['id'] ?? '';
        $this->deleteTenantResource('deadlines', $id, $companyId, 'Prazo');
        Response::success(null, 'Prazo excluído');
    }
}
