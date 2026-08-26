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

    public static function serverError(\Throwable|string $error = 'Ocorreu um erro interno', int $statusCode = 500): void
    {
        $errorId = 'err_' . substr(bin2hex(random_bytes(8)), 0, 16);
        $message = is_string($error) ? $error : $error->getMessage();
        $file = $error instanceof \Throwable ? $error->getFile() : '';
        $line = $error instanceof \Throwable ? $error->getLine() : 0;
        $trace = $error instanceof \Throwable ? $error->getTraceAsString() : '';

        error_log(sprintf('[SERVER_ERROR ID=%s] %s in %s:%d' . PHP_EOL . 'Trace:' . PHP_EOL . '%s', $errorId, $message, $file, $line, $trace));

        $isDebug = (Config::get('APP_DEBUG') === 'true' || Config::get('APP_DEBUG') === '1') && Config::get('APP_ENV') !== 'production';

        if ($isDebug) {
            self::json([
                'success' => false,
                'error' => $message,
                'error_id' => $errorId,
                'file' => $file,
                'line' => $line,
            ], $statusCode);
        } else {
            self::json([
                'success' => false,
                'error' => 'Ocorreu um erro interno no servidor. Por favor, contate o suporte com o código do erro.',
                'error_id' => $errorId,
            ], $statusCode);
        }
    }
}
