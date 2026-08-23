<?php

namespace App;

/**
 * Autoloader PSR-4 para o backend MedCore em PHP.
 * Permite carregamento instantâneo de classes sem necessidade obrigatória de Composer.
 */
class Autoloader
{
    private static array $prefixes = [];

    public static function register(): void
    {
        spl_autoload_register([__CLASS__, 'loadClass']);
    }

    public static function addNamespace(string $prefix, string $baseDir): void
    {
        $prefix = trim($prefix, '\\') . '\\';
        $baseDir = rtrim($baseDir, DIRECTORY_SEPARATOR) . '/';
        self::$prefixes[$prefix] = $baseDir;
    }

    public static function loadClass(string $class): bool
    {
        foreach (self::$prefixes as $prefix => $baseDir) {
            $len = strlen($prefix);
            if (strncmp($prefix, $class, $len) !== 0) {
                continue;
            }

            $relativeClass = substr($class, $len);
            $file = $baseDir . str_replace('\\', '/', $relativeClass) . '.php';

            if (file_exists($file)) {
                require_once $file;
                return true;
            }
        }
        return false;
    }
}
