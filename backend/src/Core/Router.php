<?php

namespace App\Core;

class Router
{
    private array $routes = [];
    private array $globalMiddlewares = [];

    public function use(callable|string $middleware): self
    {
        $this->globalMiddlewares[] = $middleware;
        return $this;
    }

    public function get(string $path, array|callable $handler, array $middlewares = []): self
    {
        return $this->addRoute('GET', $path, $handler, $middlewares);
    }

    public function post(string $path, array|callable $handler, array $middlewares = []): self
    {
        return $this->addRoute('POST', $path, $handler, $middlewares);
    }

    public function put(string $path, array|callable $handler, array $middlewares = []): self
    {
        return $this->addRoute('PUT', $path, $handler, $middlewares);
    }

    public function patch(string $path, array|callable $handler, array $middlewares = []): self
    {
        return $this->addRoute('PATCH', $path, $handler, $middlewares);
    }

    public function delete(string $path, array|callable $handler, array $middlewares = []): self
    {
        return $this->addRoute('DELETE', $path, $handler, $middlewares);
    }

    public function options(string $path, array|callable $handler): self
    {
        return $this->addRoute('OPTIONS', $path, $handler, []);
    }

    private function addRoute(string $method, string $path, array|callable $handler, array $middlewares = []): self
    {
        $normalizedPath = '/' . trim($path, '/');
        $this->routes[] = [
            'method' => $method,
            'path' => $normalizedPath,
            'pattern' => $this->compilePattern($normalizedPath),
            'handler' => $handler,
            'middlewares' => $middlewares,
        ];
        return $this;
    }

    private function compilePattern(string $path): string
    {
        // Converte {param} em named regex capture group (?P<param>[^/]+)
        $pattern = preg_replace('/\{([a-zA-Z0-9_]+)\}/', '(?P<$1>[^/]+)', $path);
        return '#^' . $pattern . '$#';
    }

    public function dispatch(Request $request): void
    {
        $method = $request->getMethod();
        $uri = $request->getUri();

        // Tratamento de pre-flight CORS
        if ($method === 'OPTIONS') {
            Response::json(['status' => 'ok'], 200, [
                'Access-Control-Allow-Origin' => '*',
                'Access-Control-Allow-Methods' => 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
                'Access-Control-Allow-Headers' => 'Content-Type, Authorization, X-Requested-With, X-Company-Id',
                'Access-Control-Max-Age' => '86400',
            ]);
            return;
        }

        // Executar middlewares globais
        foreach ($this->globalMiddlewares as $middleware) {
            $this->executeMiddleware($middleware, $request);
        }

        foreach ($this->routes as $route) {
            if ($route['method'] !== $method) {
                continue;
            }

            if (preg_match($route['pattern'], $uri, $matches)) {
                $params = array_filter($matches, 'is_string', ARRAY_FILTER_USE_KEY);

                // Executar middlewares da rota
                foreach ($route['middlewares'] as $middleware) {
                    $this->executeMiddleware($middleware, $request);
                }

                $this->executeHandler($route['handler'], $request, $params);
                return;
            }
        }

        Response::notFound("Rota {$method} {$uri} não encontrada no backend PHP");
    }

    private function executeMiddleware(callable|string $middleware, Request $request): void
    {
        if (is_string($middleware) && class_exists($middleware)) {
            $instance = new $middleware();
            if (method_exists($instance, 'handle')) {
                $instance->handle($request);
                return;
            }
        }

        if (is_callable($middleware)) {
            $middleware($request);
        }
    }

    private function executeHandler(array|callable $handler, Request $request, array $params): void
    {
        if (is_array($handler) && count($handler) === 2) {
            [$class, $method] = $handler;
            if (is_string($class) && class_exists($class)) {
                $controller = new $class();
                $controller->$method($request, $params);
                return;
            }
        }

        if (is_callable($handler)) {
            $handler($request, $params);
            return;
        }

        Response::error('Handler inválido para esta rota', 500);
    }
}
