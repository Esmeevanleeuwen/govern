<?php
declare(strict_types=1);

// Reuse the storage schema supplied by the official, versioned phpMyAdmin image.
// Only this application's configured database is selected. No separate pmadb.
$file = getenv('PMA_STORAGE_SCHEMA_FILE') ?: '/var/www/html/sql/create_tables.sql';
$sql = file_get_contents($file);
if ($sql === false) {
    throw new RuntimeException('Het officiële phpMyAdmin-opslagschema ontbreekt.');
}
$sql = preg_replace('/^CREATE DATABASE IF NOT EXISTS `phpmyadmin`\s+DEFAULT CHARACTER SET utf8 COLLATE utf8_bin;\s*USE phpmyadmin;/m', '', $sql, 1, $replaced);
if ($replaced !== 1 || $sql === null) {
    throw new RuntimeException('Het phpMyAdmin-opslagschema is gewijzigd; controleer de initialisatie.');
}
$sql = str_replace('pma__', '_govern_pma__', $sql);

mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
$database = null;
for ($attempt = 0; $attempt < 30; $attempt++) {
    try {
        $database = new mysqli(
            getenv('PMA_HOST') ?: 'database',
            getenv('PMA_USER') ?: 'govern',
            getenv('PMA_PASSWORD') ?: '',
            getenv('DB_NAME') ?: 'bestuursatlas',
            (int) (getenv('PMA_PORT') ?: 3306),
            getenv('PMA_SOCKET') ?: null,
        );
        break;
    } catch (mysqli_sql_exception $exception) {
        if ($attempt === 29) {
            throw new RuntimeException('phpMyAdmin kon de werkdatabase niet openen.', 0, $exception);
        }
        usleep(500000);
    }
}
$database->set_charset('utf8mb4');
$database->multi_query($sql);
do {
    if ($result = $database->store_result()) {
        $result->free();
    }
} while ($database->more_results() && $database->next_result());
$database->close();
fwrite(STDOUT, "phpMyAdmin-opslag is beschikbaar in de werkdatabase.\n");
