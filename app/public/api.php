<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/src/bootstrap.php';

use Govern\ApiException;
use Govern\BackupService;
use Govern\Catalog;
use Govern\Config;
use Govern\Database;
use Govern\Http;
use Govern\MaintenanceLock;
use Govern\QueryRunner;
use Govern\SavedQueries;

try {
    $config = Config::fromEnvironment();
    $csrf = Http::start($config);
    $action = Http::text($_GET, 'action');
    $posts = ['query', 'save-query', 'delete-query', 'create-snapshot', 'restore-snapshot'];
    $input = in_array($action, $posts, true) ? Http::post($csrf) : [];
    if (!in_array($action, $posts, true)) {
        Http::get();
    }
    $snapshotActions = ['snapshots', 'create-snapshot', 'restore-snapshot', 'download-snapshot'];
    if (in_array($action, $snapshotActions, true)) {
        $backup = new BackupService($config);
        if ($action === 'snapshots') {
            Http::json($backup->list());
        }
        if ($action === 'create-snapshot') {
            Http::json($backup->create(Http::text($input, 'label', false)), 201);
        }
        if ($action === 'restore-snapshot') {
            Http::json($backup->restore(Http::text($input, 'id'), Http::text($input, 'confirmation')));
        }
        $download = $backup->download(Http::text($_GET, 'id'));
        $stream = @fopen($download['path'], 'rb');
        if ($stream === false) {
            throw new ApiException('Het herstelpunt kan niet worden geopend.', 503);
        }
        header('Content-Type: application/sql; charset=utf-8');
        header('Content-Disposition: attachment; filename="' . preg_replace('/[^A-Za-z0-9._-]/', '_', $download['filename']) . '"');
        header('Content-Length: ' . (string) filesize($download['path']));
        fpassthru($stream);
        fclose($stream);
        exit;
    }
    $database = new Database($config);
    $catalog = new Catalog($database);
    $queries = new SavedQueries($database, $config);
    if ($action === 'bootstrap') {
        $data = ['csrf' => $csrf, 'database' => ['name' => $config['name'], 'version' => null, 'status' => 'unavailable', 'available' => false],
            'stats' => ['tables' => 0, 'views' => 0, 'rows_estimate' => 0], 'tables' => []];
        try {
            $lock = new MaintenanceLock($config['backup_dir']);
            $data['tables'] = $catalog->tables();
            $data['database']['version'] = $database->reader()->getAttribute(PDO::ATTR_SERVER_VERSION);
            $data['database']['status'] = 'ready';
            $data['database']['available'] = true;
            foreach ($data['tables'] as $table) {
                $data['stats'][$table['type'] === 'view' ? 'views' : 'tables']++;
                $data['stats']['rows_estimate'] += $table['rows_estimate'];
            }
        } catch (PDOException $exception) {
            $missing = (int) ($exception->errorInfo[1] ?? 0) === 1049;
            $data['warning'] = $missing
                ? 'De database bestaat niet. Je kunt onder Experimenten een herstelpunt terugzetten.'
                : 'De database is niet bereikbaar of nog niet gereed. Controleer of Docker draait. Herstelpunten blijven beschikbaar.';
            error_log('Govern bootstrap database error [' . $exception->getCode() . ']');
        } catch (ApiException $exception) {
            $data['warning'] = $exception->getMessage();
        }
        Http::json($data);
    }
    $lock = new MaintenanceLock($config['backup_dir']);
    switch ($action) {
        case 'health':
            $database->reader()->query('SELECT 1')->fetchColumn();
            Http::json(['status' => 'ok']);
        case 'browse':
            Http::json($catalog->browse(Http::text($_GET, 'table'), Http::integer($_GET, 'page', 1), Http::integer($_GET, 'page_size', 25), Http::text($_GET, 'q', false)));
        case 'structure':
            Http::json($catalog->structure(Http::text($_GET, 'table')));
        case 'query':
            Http::json((new QueryRunner($database))->execute(Http::text($input, 'sql')));
        case 'queries':
            Http::json($queries->list());
        case 'save-query':
            Http::json($queries->save($input));
        case 'delete-query':
            Http::json($queries->delete($input['id'] ?? null));
        case 'context':
            $schema = [];
            foreach ($catalog->tables() as $table) {
                $schema[] = $catalog->structure($table['name']);
            }
            $context = ['format' => 'govern-context', 'version' => 1, 'created_at' => gmdate('c'),
                'database' => $config['name'], 'schema' => $schema, 'saved_queries' => $queries->list(),
                'contents' => 'Databasestructuur en opgeslagen SQL-vragen, inclusief de tekst die je daarin bewaart. Geen tabelrijen of appconfiguratie.'];
            header('Content-Type: application/json; charset=utf-8');
            header('Content-Disposition: attachment; filename="govern-context-' . gmdate('Ymd-His') . '.json"');
            echo json_encode($context, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE | JSON_THROW_ON_ERROR);
            exit;
        default:
            throw new ApiException('Deze handeling bestaat niet.', 404);
    }
} catch (ApiException $exception) {
    Http::json($exception->getMessage(), $exception->status, false);
} catch (InvalidArgumentException $exception) {
    Http::json($exception->getMessage(), 422, false);
} catch (PDOException $exception) {
    if ((int) ($exception->errorInfo[1] ?? 0) === 1792) {
        Http::json('Deze leesopdracht probeert gegevens te wijzigen. Gebruik het phpMyAdmin-venster voor wijzigingen.', 403, false);
    }
    error_log('Govern database error [' . $exception->getCode() . ']');
    Http::json('De database kon deze handeling niet uitvoeren. Vernieuw de werkplek of controleer de databaseverbinding.', 503, false);
} catch (RuntimeException $exception) {
    // BackupService's operational messages are prepared for the local user.
    Http::json($exception->getMessage(), 503, false);
} catch (Throwable $exception) {
    error_log('Govern internal error [' . get_class($exception) . ']');
    Http::json('Er ging iets mis in de werkplek. Bekijk de lokale applicatielog voor meer informatie.', 500, false);
}
