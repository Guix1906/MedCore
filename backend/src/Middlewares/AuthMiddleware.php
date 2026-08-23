<?php

namespace App\Middlewares;

use App\Core\Request;
use App\Core\Response;
use App\Helpers\Jwt;

class AuthMiddleware
{
    public function handle(Request $request): void
    {
        $token = $request->getBearerToken();
        if (!$token) {
            Response::unauthorized('Token de autorização ausente');
        }

        $decoded = Jwt::decode($token);
        if (!$decoded) {
            Response::unauthorized('Token de autorização inválido ou expirado');
        }

        $request->setUser($decoded);
    }
}
