<?php

namespace App\Controllers;

use App\Core\Request;
use App\Core\Response;
use App\Core\Database;

class NotificationController
{
    public function index(Request $request): void
    {
        $userId = $request->getUserId();
        $notifications = Database::fetchAll("
            SELECT * FROM notifications 
            WHERE (user_id = :uid OR user_id IS NULL)
            ORDER BY created_at DESC 
            LIMIT 50
        ", ['uid' => $userId]);

        if (empty($notifications)) {
            $defaultNotifs = [
                ['id' => 'not_1', 'user_id' => $userId, 'title' => 'Bem-vindo ao MedCore PHP', 'message' => 'O sistema agora está operando com alta performance e baixa latência.', 'type' => 'success', 'read' => 0],
                ['id' => 'not_2', 'user_id' => $userId, 'title' => 'Agendamentos do Dia', 'message' => 'Você tem consultas agendadas para hoje.', 'type' => 'info', 'read' => 0],
            ];
            foreach ($defaultNotifs as $n) {
                Database::insert('notifications', $n);
            }
            $notifications = Database::fetchAll("SELECT * FROM notifications WHERE (user_id = :uid OR user_id IS NULL) ORDER BY created_at DESC LIMIT 50", ['uid' => $userId]);
        }

        foreach ($notifications as &$n) {
            $n['read'] = (bool) $n['read'];
        }

        Response::success($notifications);
    }

    public function markAsRead(Request $request): void
    {
        $ids = $request->input('ids');
        $id = $request->input('id');

        if (!empty($ids) && is_array($ids)) {
            $placeholders = implode(',', array_fill(0, count($ids), '?'));
            $stmt = Database::getConnection()->prepare("UPDATE notifications SET read = 1 WHERE id IN ({$placeholders})");
            $stmt->execute(array_values($ids));
        } elseif (!empty($id)) {
            Database::update('notifications', ['read' => 1], 'id = :id', ['id' => $id]);
        } else {
            Database::execute("UPDATE notifications SET read = 1");
        }

        Response::success(null, 'Notificações marcadas como lidas');
    }

    public function snooze(Request $request): void
    {
        $id = $request->input('id');
        $snoozeUntil = $request->input('snooze_until', date('Y-m-d H:i:s', strtotime('+1 hour')));

        if (!empty($id)) {
            Database::update('notifications', [
                'read' => 1,
                'snoozed_until' => $snoozeUntil
            ], 'id = :id', ['id' => $id]);
        }

        Response::success(null, 'Notificação adiada');
    }
}
