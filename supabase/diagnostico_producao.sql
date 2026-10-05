-- =============================================================================
-- MedCore: diagnóstico do banco de produção (somente leitura, não altera nada).
-- Cole no SQL Editor do Supabase e execute. Cada linha do resultado é um item
-- que as migrações de supabase/migrations criam, mas que NÃO existe no banco.
-- Resultado vazio = banco em dia.
-- =============================================================================

WITH expected_tables(name) AS (
  VALUES ('account_transfers'),('activity_log'),('appointments'),('attachments'),
    ('bank_reconciliations'),('bank_statement_lines'),('card_settlements'),('cash_register_movements'),
    ('cash_register_sessions'),('clinic_settings'),('commission_allocations'),('companies'),
    ('company_invitations'),('company_member_audit'),('company_members'),('company_roles'),
    ('deadlines'),('doctors'),('events'),('exam_orders'),('finance_categories'),
    ('financial_accounts'),('financial_audit_log'),('financial_classifications'),('inventory_items'),
    ('inventory_movements'),('medical_record_addenda'),('medical_record_versions'),('medical_records'),
    ('notifications'),('patient_consents'),('patient_quotes'),('patients'),('permission_catalog'),
    ('prescriptions'),('profiles'),('record_access_log'),('recurring_transactions'),('service_types'),
    ('transaction_payments'),('transactions'),('treatment_evolutions'),('treatment_installments'),
    ('treatment_medication_uses'),('treatment_medications'),('treatment_photos'),
    ('treatment_status_history'),('treatments'),('vital_signs'),('waitlist')
),
expected_functions(name) AS (
  VALUES ('accept_company_invitation'),('admin_create_direct_user'),('admin_create_invitation'),
    ('admin_get_overview'),('admin_list_audit'),('admin_save_role'),('admin_set_member_status'),
    ('admin_set_user_password'),('admin_update_member'),('can_access_treatment'),
    ('cancel_appointment_finance'),('cancel_financial_title'),('configure_treatment_payment'),
    ('create_event_financial_title'),('create_financial_account'),('create_financial_title'),
    ('delete_agenda_event'),('delete_financial_title'),('delete_medical_record'),('delete_patient'),
    ('delete_treatment'),('delete_treatment_evolution'),('finance_allowed'),('get_agenda_events'),
    ('get_cash_flow_snapshot'),('get_financial_operations'),('get_financial_plans'),
    ('get_financial_snapshot'),('get_my_access'),('get_treatment_alerts'),('has_any_permission'),
    ('has_permission'),('import_financial_statement'),('is_clinic_member'),('is_company_member'),
    ('label_free_balance_title'),('log_record_access'),('move_inventory_item'),
    ('pay_treatment_installment'),('reconcile_financial_entry'),('record_account_transfer'),
    ('record_financial_payment'),('record_treatment_evolution'),('record_treatment_medication_use'),
    ('register_patient_consent'),('repactuate_treatment_balance'),('reverse_financial_payment'),
    ('reverse_financial_reconciliation'),('save_agenda_event'),('save_clinic_profile'),
    ('schedule_appointment_finance'),('settle_appointment_remaining')
),
expected_columns(tbl, col) AS (
  VALUES ('events','company_id'),('events','patient_id'),('transactions','company_id'),
    ('financial_accounts','company_id'),('company_members','effective_permissions'),
    ('profiles','active_company_id'),('recurring_transactions','company_id')
)
SELECT 'TABELA FALTANDO' AS problema, t.name AS item
FROM expected_tables t
WHERE to_regclass('public.' || t.name) IS NULL
UNION ALL
SELECT 'FUNÇÃO FALTANDO', f.name
FROM expected_functions f
WHERE NOT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = f.name
)
UNION ALL
SELECT 'COLUNA FALTANDO', c.tbl || '.' || c.col
FROM expected_columns c
WHERE to_regclass('public.' || c.tbl) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = c.tbl AND column_name = c.col
  )
UNION ALL
-- Falhas de segurança conhecidas que NÃO podem existir.
SELECT 'PERIGO: função de reset ainda existe', 'reset_all_system_test_data'
WHERE EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'reset_all_system_test_data')
UNION ALL
SELECT 'PERIGO: tabela sem RLS', c.relname
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
UNION ALL
SELECT 'PERIGO: acesso anônimo de escrita', table_name || ' (' || string_agg(privilege_type, ',') || ')'
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND grantee = 'anon'
  AND privilege_type IN ('INSERT','UPDATE','DELETE')
GROUP BY table_name
ORDER BY 1, 2;
