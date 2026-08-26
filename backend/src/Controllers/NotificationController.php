<?php

namespace App\Controllers;

use App\Core\Request;
use App\Core\Response;
use App\Core\Database;

class NotificationController extends BaseController
{
    public function index(Request $request): void
    {
        $userId = $request->getUserId();
        $companyId = $this->getTenantCompanyId($request);
        $notifications = Database::fetchAll("
            SELECT * FROM notifications 
            WHERE (user_id = :uid OR user_id IS NULL) AND (company_id = :cid OR company_id IS NULL)
            ORDER BY created_at DESC 
            LIMIT 50
        ", ['uid' => $userId, 'cid' => $companyId]);

        foreach ($notifications as &$n) {
            $n['read'] = (bool) $n['read'];
        }

        Response::success($notifications);
    }

    public function markAsRead(Request $request): void
    {
        $userId = $request->getUserId();
        $companyId = $this->getTenantCompanyId($request);
        $ids = $request->input('ids');
        $id = $request->input('id');

        if (!empty($ids) && is_array($ids)) {
            $placeholders = implode(',', array_fill(0, count($ids), '?'));
            $params = array_values($ids);
            $params[] = $userId;
            $params[] = $companyId;
            $stmt = Database::getConnection()->prepare("
                UPDATE notifications 
                SET read = 1 
                WHERE id IN ({$placeholders}) AND (user_id = ? OR user_id IS NULL) AND (company_id = ? OR company_id IS NULL)
            ");
            $stmt->execute($params);
        } elseif (!empty($id)) {
            Database::execute("
                UPDATE notifications 
                SET read = 1 
                WHERE id = :id AND (user_id = :uid OR user_id IS NULL) AND (company_id = :cid OR company_id IS NULL)
            ", ['id' => $id, 'uid' => $userId, 'cid' => $companyId]);
        } else {
            Database::execute("
                UPDATE notifications 
                SET read = 1 
                WHERE (user_id = :uid OR user_id IS NULL) AND (company_id = :cid OR company_id IS NULL)
            ", ['uid' => $userId, 'cid' => $companyId]);
        }

        Response::success(null, 'Notificações marcadas como lidas');
    }

    public function snooze(Request $request): void
    {
        $userId = $request->getUserId();
        $companyId = $this->getTenantCompanyId($request);
        $id = $request->input('id');
        $snoozeUntil = $request->input('snooze_until', date('Y-m-d H:i:s', strtotime('+1 hour')));

        if (!empty($id)) {
            Database::execute("
                UPDATE notifications 
                SET read = 1, snoozed_until = :snooze 
                WHERE id = :id AND (user_id = :uid OR user_id IS NULL) AND (company_id = :cid OR company_id IS NULL)
            ", ['id' => $id, 'snooze' => $snoozeUntil, 'uid' => $userId, 'cid' => $companyId]);
        }

        Response::success(null, 'Notificação adiada');
    }
}
