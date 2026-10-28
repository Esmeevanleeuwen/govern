<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/src/bootstrap.php';

use Govern\ApiException;
use Govern\BackupService;
use Govern\BackupException;
use Govern\BackupInputException;
use Govern\Catalog;
use Govern\Config;
use Govern\Database;
use Govern\Http;
use Govern\MaintenanceLock;
use Govern\Messages;
use Govern\QueryDesigner;
use Govern\QueryRunner;
use Govern\SavedQueries;

try {
    $config = Config::fromEnvironment();
    $csrf = Http::start($config);
    $action = Http::text($_GET, 'action');
    $posts = ['build-query', 'query', 'save-query', 'delete-query', 'create-snapshot', 'restore-snapshot'];
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
            throw ApiException::fromCode('snapshot_open_failed', 503);
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
            $warning = $missing ? 'database_missing_warning' : 'database_unavailable_warning';
            $data['warning'] = Messages::text($warning);
            $data['warning_i18n'] = Messages::translations($warning);
            error_log('Govern bootstrap database error [' . $exception->getCode() . ']');
        } catch (ApiException $exception) {
            $data['warning'] = $exception->getMessage();
            $data['warning_i18n'] = Messages::translations($exception->errorCode, $exception->errorParams);
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
        case 'build-query':
            if (array_keys($input) !== ['design']) {
                throw ApiException::fromCode('design_only', 422);
            }
            $built = (new QueryDesigner($database))->compile($input['design']);
            Http::json(['sql' => $built['sql'], 'explanation' => $built['explanation'], 'explanation_i18n' => $built['explanation_i18n']]);
        case 'query':
            if (array_keys($input) === ['sql']) {
                Http::json((new QueryRunner($database))->execute(Http::text($input, 'sql')));
            }
            if (array_keys($input) === ['design']) {
                $built = (new QueryDesigner($database))->compile($input['design']);
                $result = (new QueryRunner($database))->execute($built['prepared_sql'], $built['params']);
                $result['sql'] = $built['sql'];
                $result['explanation'] = $built['explanation'];
                $result['explanation_i18n'] = $built['explanation_i18n'];
                Http::json($result);
            }
            throw ApiException::fromCode('query_shape_invalid', 422);
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
            throw ApiException::fromCode('action_missing', 404);
    }
} catch (ApiException $exception) {
    Http::json($exception->getMessage(), $exception->status, false, $exception->errorCode, $exception->errorParams);
} catch (BackupInputException $exception) {
    Http::json($exception->getMessage(), 422, false, $exception->errorCode, $exception->errorParams);
} catch (BackupException $exception) {
    Http::json($exception->getMessage(), 503, false, $exception->errorCode, $exception->errorParams);
} catch (InvalidArgumentException $exception) {
    Http::json(Messages::text('request_failed'), 422, false, 'request_failed');
} catch (PDOException $exception) {
    if ((int) ($exception->errorInfo[1] ?? 0) === 1792) {
        Http::json(Messages::text('read_attempted_write'), 403, false, 'read_attempted_write');
    }
    error_log('Govern database error [' . $exception->getCode() . ']');
    Http::json(Messages::text('database_action_failed'), 503, false, 'database_action_failed');
} catch (RuntimeException $exception) {
    error_log('Govern operational error [' . get_class($exception) . ']');
    Http::json(Messages::text('internal_error'), 503, false, 'internal_error');
} catch (Throwable $exception) {
    error_log('Govern internal error [' . get_class($exception) . ']');
    Http::json(Messages::text('internal_error'), 500, false, 'internal_error');
}
