<?php

namespace App\Controllers;

use App\Core\Request;
use App\Core\Response;
use App\Core\Database;

class InventoryController extends BaseController
{
    public function index(Request $request): void
    {
        $companyId = $this->getTenantCompanyId($request);
        $q = trim((string) $request->query('q', ''));
        $category = $request->query('category');

        $sql = "SELECT * FROM inventory_items WHERE (company_id = :cid OR company_id IS NULL) AND active = 1";
        $params = ['cid' => $companyId];

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
        $companyId = $this->getTenantCompanyId($request);
        $name = trim($request->input('name', ''));
        if (empty($name)) {
            Response::error('Nome do item é obrigatório', 422);
        }

        $id = $request->input('id') ?: 'inv_' . substr(bin2hex(random_bytes(8)), 0, 16);

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

        $item = $this->findTenantResource('inventory_items', $id, $companyId, 'Item');
        Response::success($item, 'Item adicionado ao estoque', 201);
    }

    public function update(Request $request, array $params): void
    {
        $companyId = $this->getTenantCompanyId($request);
        $id = $params['id'] ?? '';
        $this->findTenantResource('inventory_items', $id, $companyId, 'Item');

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
            Database::update('inventory_items', $updateData, 'id = :id AND company_id = :cid', ['id' => $id, 'cid' => $companyId]);
        }

        $item = $this->findTenantResource('inventory_items', $id, $companyId, 'Item');
        Response::success($item, 'Item atualizado com sucesso');
    }

    public function destroy(Request $request, array $params): void
    {
        $companyId = $this->getTenantCompanyId($request);
        $id = $params['id'] ?? '';
        $this->findTenantResource('inventory_items', $id, $companyId, 'Item');
        Database::update('inventory_items', ['active' => 0], 'id = :id AND company_id = :cid', ['id' => $id, 'cid' => $companyId]);
        Response::success(null, 'Item removido');
    }
}
