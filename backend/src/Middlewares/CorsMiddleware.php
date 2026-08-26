<?php

namespace App\Middlewares;

use App\Core\Request;
use App\Core\Config;

class CorsMiddleware
{
    public function handle(Request $request): void
    {
        $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
        $allowedOriginsRaw = Config::get('CORS_ALLOWED_ORIGINS', 'http://localhost:5173,http://localhost:8080,http://127.0.0.1:5173,http://127.0.0.1:8080');
        $allowedOrigins = array_map('trim', explode(',', (string)$allowedOriginsRaw));

        $isAllowed = false;

        if (!empty($origin)) {
            // Verificar correspondência exata
            if (in_array($origin, $allowedOrigins, true)) {
                $isAllowed = true;
            } else {
                // Verificar curingas seguros (ex: https://*.lovable.app)
                foreach ($allowedOrigins as $pattern) {
                    if (str_contains($pattern, '*')) {
                        $regex = '#^' . str_replace('\*', '[a-zA-Z0-9\-]+', preg_quote($pattern, '#')) . '$#';
                        if (preg_match($regex, $origin)) {
                            $isAllowed = true;
                            break;
                        }
                    }
                }
            }
        }

        if ($isAllowed && !empty($origin)) {
            header("Access-Control-Allow-Origin: {$origin}");
            header('Access-Control-Allow-Credentials: true');
            header('Vary: Origin');
        }

        header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, X-Company-Id, Accept, Origin');
        header('Access-Control-Max-Age: 86400');

        // Tratamento de requisições preflight OPTIONS
        if (strtoupper($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
            if ($isAllowed || empty($origin)) {
                http_response_code(204);
            } else {
                http_response_code(403);
            }
            exit;
        }
    }
}

