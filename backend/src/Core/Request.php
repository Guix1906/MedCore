<?php

namespace App\Core;

class Request
{
    private string $method;
    private string $uri;
    private array $queryParams;
    private array $bodyParams = [];
    private array $headers;
    private ?array $user = null;

    public function __construct()
    {
        $this->method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
        
        $requestUri = $_SERVER['REQUEST_URI'] ?? '/';
        $parsedUri = parse_url($requestUri, PHP_URL_PATH);
        $this->uri = '/' . trim($parsedUri, '/');

        $this->queryParams = $_GET;
        $this->headers = $this->extractHeaders();

        // Parse JSON body se content-type for application/json
        $contentType = $this->getHeader('Content-Type') ?? '';
        if (str_contains(strtolower($contentType), 'application/json') || in_array($this->method, ['POST', 'PUT', 'PATCH', 'DELETE'])) {
            $rawInput = file_get_contents('php://input');
            if (!empty($rawInput)) {
                $decoded = json_decode($rawInput, true);
                if (is_array($decoded)) {
                    $this->bodyParams = $decoded;
                }
            }
        }

        if (empty($this->bodyParams) && !empty($_POST)) {
            $this->bodyParams = $_POST;
        }
    }

    public function getMethod(): string
    {
        return $this->method;
    }

    public function getUri(): string
    {
        return $this->uri;
    }

    public function query(string $key, mixed $default = null): mixed
    {
        return $this->queryParams[$key] ?? $default;
    }

    public function allQuery(): array
    {
        return $this->queryParams;
    }

    public function input(string $key, mixed $default = null): mixed
    {
        return $this->bodyParams[$key] ?? $this->queryParams[$key] ?? $default;
    }

    public function all(): array
    {
        return array_merge($this->queryParams, $this->bodyParams);
    }

    public function body(): array
    {
        return $this->bodyParams;
    }

    public function getHeader(string $name): ?string
    {
        $nameLower = strtolower($name);
        foreach ($this->headers as $key => $value) {
            if (strtolower($key) === $nameLower) {
                return $value;
            }
        }
        return null;
    }

    public function getBearerToken(): ?string
    {
        $auth = $this->getHeader('Authorization');
        if ($auth && preg_match('/Bearer\s+(\S+)/i', $auth, $matches)) {
            return $matches[1];
        }
        return null;
    }

    public function setUser(?array $user): void
    {
        $this->user = $user;
    }

    public function getUser(): ?array
    {
        return $this->user;
    }

    public function getUserId(): ?string
    {
        return $this->user['id'] ?? $this->user['sub'] ?? null;
    }

    public function getCompanyId(): ?string
    {
        return $this->user['active_company_id'] ?? $this->getHeader('X-Company-Id') ?? null;
    }

    private function extractHeaders(): array
    {
        $headers = [];
        if (function_exists('getallheaders')) {
            $headers = getallheaders();
            if ($headers !== false) {
                return $headers;
            }
        }

        foreach ($_SERVER as $key => $value) {
            if (str_starts_with($key, 'HTTP_')) {
                $headerName = str_replace('_', '-', ucwords(strtolower(substr($key, 5)), '_'));
                $headers[$headerName] = $value;
            } elseif (in_array($key, ['CONTENT_TYPE', 'CONTENT_LENGTH'])) {
                $headerName = str_replace('_', '-', ucwords(strtolower($key), '_'));
                $headers[$headerName] = $value;
            }
        }

        return $headers;
    }
}
