<?php

namespace App\Controllers;

use App\Core\Request;
use App\Core\Response;
use App\Core\Database;

class FinanceController
{
    public function transactions(Request $request): void
    {
        $type = $request->query('type');
        $status = $request->query('status');
        $startDate = $request->query('start_date');
        $endDate = $request->query('end_date');
        $limit = (int) $request->query('limit', 1000);

        $sql = "
            SELECT t.*, 
                   p.name as patient_name,
                   c.name as category_name, c.color as category_color,
                   a.name as account_name
            FROM transactions t
            LEFT JOIN patients p ON p.id = t.patient_id
            LEFT JOIN financial_categories c ON c.id = t.category_id
            LEFT JOIN financial_accounts a ON a.id = t.account_id
            WHERE 1=1
        ";
        $params = [];

        if (!empty($type)) {
            $sql .= " AND t.type = :type";
            $params['type'] = $type;
        }

        if (!empty($status)) {
            $sql .= " AND t.status = :status";
            $params['status'] = $status;
        }

        if (!empty($startDate) && !empty($endDate)) {
            $sql .= " AND t.date BETWEEN :start_date AND :end_date";
            $params['start_date'] = $startDate;
            $params['end_date'] = $endDate;
        }

        $sql .= " ORDER BY t.date DESC, t.created_at DESC LIMIT {$limit}";

        $transactions = Database::fetchAll($sql, $params);

        foreach ($transactions as &$t) {
            $t['amount'] = (float) $t['amount'];
        }

        Response::success($transactions);
    }

    public function metrics(Request $request): void
    {
        $startDate = $request->query('start_date', date('Y-m-01'));
        $endDate = $request->query('end_date', date('Y-m-t'));

        $income = Database::fetchOne("
            SELECT COALESCE(SUM(amount), 0) as total 
            FROM transactions 
            WHERE type = 'income' AND status = 'completed' AND date BETWEEN :start AND :end
        ", ['start' => $startDate, 'end' => $endDate]);

        $expense = Database::fetchOne("
            SELECT COALESCE(SUM(amount), 0) as total 
            FROM transactions 
            WHERE type = 'expense' AND status = 'completed' AND date BETWEEN :start AND :end
        ", ['start' => $startDate, 'end' => $endDate]);

        $pendingIncome = Database::fetchOne("
            SELECT COALESCE(SUM(amount), 0) as total 
            FROM transactions 
            WHERE type = 'income' AND status = 'pending' AND date BETWEEN :start AND :end
        ", ['start' => $startDate, 'end' => $endDate]);

        $pendingExpense = Database::fetchOne("
            SELECT COALESCE(SUM(amount), 0) as total 
            FROM transactions 
            WHERE type = 'expense' AND status = 'pending' AND date BETWEEN :start AND :end
        ", ['start' => $startDate, 'end' => $endDate]);

        $totalIncome = (float) ($income['total'] ?? 0);
        $totalExpense = (float) ($expense['total'] ?? 0);

        Response::success([
            'total_income' => $totalIncome,
            'total_expense' => $totalExpense,
            'balance' => $totalIncome - $totalExpense,
            'pending_income' => (float) ($pendingIncome['total'] ?? 0),
            'pending_expense' => (float) ($pendingExpense['total'] ?? 0),
        ]);
    }

    public function storeTransaction(Request $request): void
    {
        $description = trim($request->input('description', ''));
        $amount = (float) $request->input('amount', 0);
        $type = $request->input('type', 'income');
        $date = $request->input('date', date('Y-m-d'));

        if (empty($description) || $amount <= 0) {
            Response::error('Descrição e valor positivo são obrigatórios', 422);
        }

        $id = $request->input('id') ?: 'tx_' . substr(bin2hex(random_bytes(8)), 0, 16);
        $companyId = $request->getCompanyId();

        Database::insert('transactions', [
            'id' => $id,
            'company_id' => $companyId,
            'account_id' => $request->input('account_id'),
            'category_id' => $request->input('category_id'),
            'patient_id' => $request->input('patient_id'),
            'doctor_id' => $request->input('doctor_id'),
            'appointment_id' => $request->input('appointment_id'),
            'type' => $type,
            'description' => $description,
            'amount' => $amount,
            'date' => $date,
            'due_date' => $request->input('due_date'),
            'status' => $request->input('status', 'completed'),
            'payment_method' => $request->input('payment_method', 'PIX'),
            'notes' => $request->input('notes'),
        ]);

        $tx = Database::fetchOne("SELECT * FROM transactions WHERE id = :id", ['id' => $id]);
        Response::success($tx, 'Transação registrada com sucesso', 201);
    }

    public function updateTransaction(Request $request, array $params): void
    {
        $id = $params['id'] ?? '';
        $fields = ['description', 'amount', 'type', 'date', 'due_date', 'status', 'payment_method', 'notes', 'category_id', 'account_id'];
        $updateData = [];

        foreach ($fields as $field) {
            $val = $request->input($field);
            if ($val !== null) {
                $updateData[$field] = $field === 'amount' ? (float) $val : $val;
            }
        }

        if (!empty($updateData)) {
            $updateData['updated_at'] = date('Y-m-d H:i:s');
            Database::update('transactions', $updateData, 'id = :id', ['id' => $id]);
        }

        $tx = Database::fetchOne("SELECT * FROM transactions WHERE id = :id", ['id' => $id]);
        Response::success($tx, 'Transação atualizada');
    }

    public function deleteTransaction(Request $request, array $params): void
    {
        $id = $params['id'] ?? '';
        Database::delete('transactions', 'id = :id', ['id' => $id]);
        Response::success(null, 'Transação excluída');
    }

    public function accounts(Request $request): void
    {
        $accounts = Database::fetchAll("SELECT * FROM financial_accounts WHERE active = 1 ORDER BY name ASC");
        if (empty($accounts)) {
            $defaultAccs = [
                ['id' => 'acc_main', 'name' => 'Conta Principal (Itaú)', 'type' => 'checking', 'balance' => 45280.00],
                ['id' => 'acc_caixa', 'name' => 'Caixa Físico Recepção', 'type' => 'cash', 'balance' => 1850.00],
            ];
            foreach ($defaultAccs as $acc) {
                Database::insert('financial_accounts', array_merge($acc, ['active' => 1]));
            }
            $accounts = Database::fetchAll("SELECT * FROM financial_accounts WHERE active = 1 ORDER BY name ASC");
        }

        foreach ($accounts as &$a) {
            $a['balance'] = (float) $a['balance'];
        }

        Response::success($accounts);
    }

    public function categories(Request $request): void
    {
        $categories = Database::fetchAll("SELECT * FROM financial_categories ORDER BY name ASC");
        if (empty($categories)) {
            $defaultCats = [
                ['id' => 'cat_1', 'name' => 'Consultas Médicas', 'type' => 'income', 'color' => '#10B981'],
                ['id' => 'cat_2', 'name' => 'Procedimentos & Cirurgias', 'type' => 'income', 'color' => '#3B82F6'],
                ['id' => 'cat_3', 'name' => 'Materiais & Medicamentos', 'type' => 'expense', 'color' => '#EF4444'],
                ['id' => 'cat_4', 'name' => 'Aluguel & Infraestrutura', 'type' => 'expense', 'color' => '#F59E0B'],
                ['id' => 'cat_5', 'name' => 'Folha de Pagamento', 'type' => 'expense', 'color' => '#8B5CF6'],
            ];
            foreach ($defaultCats as $c) {
                Database::insert('financial_categories', $c);
            }
            $categories = Database::fetchAll("SELECT * FROM financial_categories ORDER BY name ASC");
        }
        Response::success($categories);
    }
}
