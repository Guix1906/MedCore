<?php

declare(strict_types=1);

// Definir cabeçalhos e controle de erros
error_reporting(E_ALL & ~E_DEPRECATED);
ini_set('display_errors', '0');

require_once __DIR__ . '/../src/Autoloader.php';

use App\Autoloader;
use App\Core\Config;
use App\Core\Database;
use App\Core\Request;
use App\Core\Response;
use App\Core\Router;
use App\Middlewares\CorsMiddleware;
use App\Middlewares\AuthMiddleware;
use App\Controllers\AuthController;
use App\Controllers\PatientController;
use App\Controllers\DoctorController;
use App\Controllers\AppointmentController;
use App\Controllers\AgendaController;
use App\Controllers\MedicalRecordController;
use App\Controllers\FinanceController;
use App\Controllers\TreatmentController;
use App\Controllers\InventoryController;
use App\Controllers\NotificationController;
use App\Controllers\SearchController;
use App\Controllers\CompanyController;

// Registrar namespaces
Autoloader::register();
Autoloader::addNamespace('App', __DIR__ . '/../src');

// Carregar variáveis de ambiente
Config::load(__DIR__ . '/../.env');

// Inicializar esquema do banco de dados automaticamente se for a primeira execução
try {
    $db = Database::getConnection();
    $schemaFile = __DIR__ . '/../database/schema.sql';
    if (file_exists($schemaFile)) {
        $sql = file_get_contents($schemaFile);
        $db->exec($sql);
    }
} catch (\Throwable $e) {
    // Log interno se necessário
}

// Inicializar Router
$router = new Router();
$router->use(CorsMiddleware::class);

// -------------------------------------------------------------
// ROTAS PÚBLICAS / AUTH
// -------------------------------------------------------------
$router->post('/api/auth/login', [AuthController::class, 'login']);
$router->post('/api/auth/register', [AuthController::class, 'register']);
$router->get('/api/health', function () {
    Response::success(['status' => 'healthy', 'version' => '1.0.0', 'engine' => 'PHP ' . PHP_VERSION]);
});

// -------------------------------------------------------------
// ROTAS PROTEGIDAS POR JWT
// -------------------------------------------------------------
$auth = [AuthMiddleware::class];

// Auth & Perfil
$router->get('/api/auth/me', [AuthController::class, 'me'], $auth);

// Pacientes
$router->get('/api/patients', [PatientController::class, 'index'], $auth);
$router->get('/api/patients/{id}', [PatientController::class, 'show'], $auth);
$router->post('/api/patients', [PatientController::class, 'store'], $auth);
$router->put('/api/patients/{id}', [PatientController::class, 'update'], $auth);
$router->delete('/api/patients/{id}', [PatientController::class, 'destroy'], $auth);

// Médicos
$router->get('/api/doctors', [DoctorController::class, 'index'], $auth);
$router->get('/api/doctors/{id}', [DoctorController::class, 'show'], $auth);

// Consultas / Agendamentos
$router->get('/api/appointments', [AppointmentController::class, 'index'], $auth);
$router->post('/api/appointments', [AppointmentController::class, 'store'], $auth);
$router->put('/api/appointments/{id}', [AppointmentController::class, 'update'], $auth);
$router->delete('/api/appointments/{id}', [AppointmentController::class, 'destroy'], $auth);

// Agenda (Tarefas, Eventos, Prazos)
$router->get('/api/tasks', [AgendaController::class, 'tasks'], $auth);
$router->post('/api/tasks', [AgendaController::class, 'storeTask'], $auth);
$router->put('/api/tasks/{id}', [AgendaController::class, 'updateTask'], $auth);
$router->delete('/api/tasks/{id}', [AgendaController::class, 'deleteTask'], $auth);

$router->get('/api/events', [AgendaController::class, 'events'], $auth);
$router->post('/api/events', [AgendaController::class, 'storeEvent'], $auth);
$router->put('/api/events/{id}', [AgendaController::class, 'updateEvent'], $auth);
$router->delete('/api/events/{id}', [AgendaController::class, 'deleteEvent'], $auth);

$router->get('/api/deadlines', [AgendaController::class, 'deadlines'], $auth);
$router->post('/api/deadlines', [AgendaController::class, 'storeDeadline'], $auth);
$router->put('/api/deadlines/{id}', [AgendaController::class, 'updateDeadline'], $auth);
$router->delete('/api/deadlines/{id}', [AgendaController::class, 'deleteDeadline'], $auth);

// Prontuários & Prescrições
$router->get('/api/medical-records', [MedicalRecordController::class, 'index'], $auth);
$router->get('/api/medical-records/{id}', [MedicalRecordController::class, 'show'], $auth);
$router->post('/api/medical-records', [MedicalRecordController::class, 'store'], $auth);

// Financeiro
$router->get('/api/transactions', [FinanceController::class, 'transactions'], $auth);
$router->get('/api/finance/metrics', [FinanceController::class, 'metrics'], $auth);
$router->post('/api/transactions', [FinanceController::class, 'storeTransaction'], $auth);
$router->put('/api/transactions/{id}', [FinanceController::class, 'updateTransaction'], $auth);
$router->delete('/api/transactions/{id}', [FinanceController::class, 'deleteTransaction'], $auth);
$router->get('/api/financial-accounts', [FinanceController::class, 'accounts'], $auth);
$router->get('/api/financial-categories', [FinanceController::class, 'categories'], $auth);

// Tratamentos & Acompanhamentos
$router->get('/api/treatments', [TreatmentController::class, 'index'], $auth);
$router->get('/api/treatments/{id}', [TreatmentController::class, 'show'], $auth);
$router->post('/api/treatments', [TreatmentController::class, 'store'], $auth);
$router->put('/api/treatments/{id}', [TreatmentController::class, 'update'], $auth);
$router->delete('/api/treatments/{id}', [TreatmentController::class, 'destroy'], $auth);
$router->post('/api/treatments/{id}/medications', [TreatmentController::class, 'storeMedication'], $auth);
$router->put('/api/treatments/{id}/medications/{medicationId}', [TreatmentController::class, 'updateMedication'], $auth);
$router->delete('/api/treatments/{id}/medications/{medicationId}', [TreatmentController::class, 'deleteMedication'], $auth);

// Estoque
$router->get('/api/inventory-items', [InventoryController::class, 'index'], $auth);
$router->post('/api/inventory-items', [InventoryController::class, 'store'], $auth);
$router->put('/api/inventory-items/{id}', [InventoryController::class, 'update'], $auth);
$router->delete('/api/inventory-items/{id}', [InventoryController::class, 'destroy'], $auth);

// Notificações
$router->get('/api/notifications', [NotificationController::class, 'index'], $auth);
$router->post('/api/notifications/read', [NotificationController::class, 'markAsRead'], $auth);
$router->post('/api/notifications/snooze', [NotificationController::class, 'snooze'], $auth);

// Busca Global
$router->get('/api/search', [SearchController::class, 'search'], $auth);

// Clínica, Membros e Serviços
$router->get('/api/company-members', [CompanyController::class, 'members'], $auth);
$router->get('/api/clinic-settings', [CompanyController::class, 'settings'], $auth);
$router->put('/api/clinic-settings', [CompanyController::class, 'updateSettings'], $auth);
$router->get('/api/service-types', [CompanyController::class, 'serviceTypes'], $auth);
$router->get('/api/cases', [CompanyController::class, 'cases'], $auth);

// Executar requisição
$request = new Request();
$router->dispatch($request);
