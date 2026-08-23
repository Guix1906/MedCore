<?php

namespace App\Controllers;

use App\Core\Request;
use App\Core\Response;
use App\Core\Database;

class InventoryController
{
    public function index(Request $request): void
    {
        $q = trim($request->query('q', ''));
        $category = $request->query('category');

        $sql = "SELECT * FROM inventory_items WHERE active = 1";
        $params = [];

        if (!empty($q)) {
            $sql .= " AND (name LIKE :q_name OR batch_number LIKE :q_batch OR supplier LIKE :q_sup)";
            $params['q_name'] = "%{$q}%";
            $params['q_batch'] = "%{$q}%";
            $params['q_sup'] = "%{$q}%";
        }

        if (!empty($category)) {
            $sql .= " AND category = :cat";
            $params['cat'] = $category;
        }

        $sql .= " ORDER BY name ASC";

        $items = Database::fetchAll($sql, $params);

        if (empty($items)) {
            $defaultItems = [
                ['id' => 'inv_1', 'name' => 'Luva de Procedimento Nitrílica M (Cx 100un)', 'category' => 'Descartáveis', 'unit' => 'cx', 'quantity' => 24, 'min_quantity' => 10, 'unit_cost' => 38.50, 'selling_price' => 0, 'supplier' => 'MedSupply Brasil'],
                ['id' => 'inv_2', 'name' => 'Seringa Descartável 5ml c/ Agulha (Cx 100un)', 'category' => 'Injetáveis', 'unit' => 'cx', 'quantity' => 15, 'min_quantity' => 5, 'unit_cost' => 45.00, 'selling_price' => 0, 'supplier' => 'Hospitalar Distribuidora'],
                ['id' => 'inv_3', 'name' => 'Álcool em Gel 70% 500ml', 'category' => 'Higiene & Assepsia', 'unit' => 'frasco', 'quantity' => 32, 'min_quantity' => 8, 'unit_cost' => 12.90, 'selling_price' => 0, 'supplier' => 'CleanMed'],
                ['id' => 'inv_4', 'name' => 'Dipirona Sódica 500mg/ml Ampola 2ml', 'category' => 'Medicamentos', 'unit' => 'ampola', 'quantity' => 80, 'min_quantity' => 30, 'unit_cost' => 3.20, 'selling_price' => 15.00, 'supplier' => 'Eurofarma'],
            ];
            foreach ($defaultItems as $it) {
                Database::insert('inventory_items', array_merge($it, ['active' => 1]));
            }
            $items = Database::fetchAll("SELECT * FROM inventory_items WHERE active = 1 ORDER BY name ASC");
        }

        foreach ($items as &$it) {
            $it['quantity'] = (float) $it['quantity'];
            $it['min_quantity'] = (float) $it['min_quantity'];
            $it['unit_cost'] = (float) $it['unit_cost'];
            $it['selling_price'] = (float) $it['selling_price'];
            $it['active'] = (bool) $it['active'];
        }

        Response::success($items);
    }

    public function store(Request $request): void
    {
        $name = trim($request->input('name', ''));
        if (empty($name)) {
            Response::error('Nome do item é obrigatório', 422);
        }

        $id = $request->input('id') ?: 'inv_' . substr(bin2hex(random_bytes(8)), 0, 16);
        $companyId = $request->getCompanyId();

        Database::insert('inventory_items', [
            'id' => $id,
            'company_id' => $companyId,
            'name' => $name,
            'category' => $request->input('category'),
            'unit' => $request->input('unit', 'un'),
            'quantity' => (float) $request->input('quantity', 0),
            'min_quantity' => (float) $request->input('min_quantity', 5),
            'unit_cost' => (float) $request->input('unit_cost', 0),
            'selling_price' => (float) $request->input('selling_price', 0),
            'expiration_date' => $request->input('expiration_date'),
            'batch_number' => $request->input('batch_number'),
            'supplier' => $request->input('supplier'),
            'notes' => $request->input('notes'),
            'active' => 1,
        ]);

        $item = Database::fetchOne("SELECT * FROM inventory_items WHERE id = :id", ['id' => $id]);
        Response::success($item, 'Item adicionado ao estoque', 201);
    }

    public function update(Request $request, array $params): void
    {
        $id = $params['id'] ?? '';
        $fields = ['name', 'category', 'unit', 'quantity', 'min_quantity', 'unit_cost', 'selling_price', 'expiration_date', 'batch_number', 'supplier', 'notes', 'active'];
        $updateData = [];

        foreach ($fields as $field) {
            $val = $request->input($field);
            if ($val !== null) {
                if (in_array($field, ['quantity', 'min_quantity', 'unit_cost', 'selling_price'])) {
                    $updateData[$field] = (float) $val;
                } else {
                    $updateData[$field] = $val;
                }
            }
        }

        if (!empty($updateData)) {
            $updateData['updated_at'] = date('Y-m-d H:i:s');
            Database::update('inventory_items', $updateData, 'id = :id', ['id' => $id]);
        }

        $item = Database::fetchOne("SELECT * FROM inventory_items WHERE id = :id", ['id' => $id]);
        Response::success($item, 'Item atualizado com sucesso');
    }

    public function destroy(Request $request, array $params): void
    {
        $id = $params['id'] ?? '';
        Database::update('inventory_items', ['active' => 0], 'id = :id', ['id' => $id]);
        Response::success(null, 'Item removido');
    }
}
