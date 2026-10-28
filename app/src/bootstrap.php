<?php
declare(strict_types=1);

spl_autoload_register(static function (string $class): void {
    $prefix = 'Govern\\';
    if (!str_starts_with($class, $prefix)) {
        return;
    }
    $name = substr($class, strlen($prefix));
    if (preg_match('/^[A-Za-z][A-Za-z0-9]*$/D', $name) !== 1) {
        return;
    }
    $file = __DIR__ . '/' . $name . '.php';
    if (is_file($file)) {
        require_once $file;
    }
});

date_default_timezone_set('UTC');
ini_set('zend.exception_ignore_args', '1');
