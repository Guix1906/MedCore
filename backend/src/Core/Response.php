<?php

namespace App\Core;

class Response
{
    public static function json(mixed $data, int $statusCode = 200, array $headers = []): void
    {
        http_response_code($statusCode);
        header('Content-Type: application/json; charset=utf-8');

        foreach ($headers as $key => $value) {
            header("{$key}: {$value}");
        }

        echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }

    public static function success(mixed $data = null, string $message = 'Sucesso', int $statusCode = 200): void
    {
        self::json([
            'success' => true,
            'message' => $message,
            'data' => $data,
        ], $statusCode);
    }

    public static function error(string $message = 'Erro na operação', int $statusCode = 400, mixed $errors = null): void
    {
        self::json([
            'success' => false,
            'error' => $message,
            'details' => $errors,
        ], $statusCode);
    }

    public static function notFound(string $message = 'Recurso não encontrado'): void
    {
        self::error($message, 404);
    }

    public static function unauthorized(string $message = 'Não autorizado'): void
    {
        self::error($message, 401);
    }

    public static function forbidden(string $message = 'Acesso negado'): void
    {
        self::error($message, 403);
    }
}
