<?php

namespace App\Middlewares;

use App\Core\Request;

class CorsMiddleware
{
    public function handle(Request $request): void
    {
        header('Access-Control-Allow-Origin: *');
        header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, X-Company-Id');
        header('Access-Control-Max-Age: 86400');
    }
}
