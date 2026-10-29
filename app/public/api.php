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
use Govern\DatabaseScope;
use Govern\Http;
use Govern\MaintenanceLock;
use Govern\Messages;
use Govern\QueryDesigner;
use Govern\QueryRunner;
use Govern\RowEditor;
use Govern\SavedQueries;
use Govern\AiService;

try {
    $baseConfig = Config::fromEnvironment();
    $csrf = Http::start($baseConfig);
    $action = Http::text($_GET, 'action');
    $posts = ['build-query', 'query', 'save-query', 'delete-query', 'create-snapshot', 'restore-snapshot', 'insert-row', 'update-row', 'delete-row', 'ai-context', 'ai-chat'];
    $input = in_array($action, $posts, true) ? Http::post($csrf) : [];
    if (!in_array($action, $posts, true)) {
        Http::get();
    }
    $scope = new DatabaseScope($baseConfig);
    if ($action === 'databases') Http::json(['databases' => $scope->databases(), 'default_database' => $baseConfig['name']]);
    $selectedDatabase = Http::text($_GET, 'database', false) ?: $baseConfig['name'];
    $config = $scope->select($selectedDatabase);
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
    if ($action === 'ai-status') Http::json((new AiService($database))->status());
    if ($action === 'bootstrap') {
        $data = ['csrf' => $csrf, 'databases' => $scope->databases(), 'default_database' => $baseConfig['name'],
            'database' => ['name' => $config['name'], 'version' => null, 'status' => 'unavailable', 'available' => false],
            'stats' => ['tables' => 0, 'views' => 0, 'rows_estimate' => 0], 'tables' => []];
        try {
            $lock = new MaintenanceLock($config['maintenance_dir']);
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
    $lock = new MaintenanceLock($config['maintenance_dir']);
    // PHP treats numeric column names as integer keys; JSON maps must stay objects.
    $recordResponse = static function (array $data): array {
        foreach (['key', 'row'] as $field) {
            if (isset($data[$field]) && is_array($data[$field])) $data[$field] = (object) $data[$field];
        }
        if (isset($data['rows'])) $data['rows'] = array_map(static fn (array $row): object => (object) $row, $data['rows']);
        if (isset($data['row_keys'])) $data['row_keys'] = array_map(static fn (?array $key): ?object => $key === null ? null : (object) $key, $data['row_keys']);
        return $data;
    };
    switch ($action) {
        case 'ai-context':
            Http::json((new AiService($database))->previewContext($input));
        case 'ai-chat':
            $ai = new AiService($database);
            $prepared = $ai->prepareChat($input);
            unset($lock);
            Http::json($ai->completeChat($prepared));
        case 'row-editor':
            $keyText = Http::text($_GET, 'key', false);
            $key = null;
            if ($keyText !== '') {
                try { $decodedKey = json_decode($keyText, false, 16, JSON_THROW_ON_ERROR); }
                catch (\JsonException) { throw ApiException::fromCode('row_key_invalid', 422); }
                if (!$decodedKey instanceof \stdClass) throw ApiException::fromCode('row_key_invalid', 422);
                $key = get_object_vars($decodedKey);
            }
            Http::json($recordResponse((new RowEditor($database))->describe(Http::text($_GET, 'table'), $key)));
        case 'insert-row':
            Http::json($recordResponse((new RowEditor($database))->insert($input)), 201);
        case 'update-row':
            Http::json($recordResponse((new RowEditor($database))->update($input)));
        case 'delete-row':
            Http::json($recordResponse((new RowEditor($database))->delete($input)));
        case 'health':
            $database->reader()->query('SELECT 1')->fetchColumn();
            Http::json(['status' => 'ok']);
        case 'browse':
            Http::json($recordResponse($catalog->browse(Http::text($_GET, 'table'), Http::integer($_GET, 'page', 1), Http::integer($_GET, 'page_size', 25), Http::text($_GET, 'q', false))));
        case 'structure':
            Http::json($catalog->structure(Http::text($_GET, 'table')));
        case 'schema':
            Http::json($catalog->schema());
        case 'build-query':
            if (array_keys($input) !== ['design']) {
                throw ApiException::fromCode('design_only', 422);
            }
            $built = (new QueryDesigner($database))->compile($input['design']);
            Http::json(['sql' => $built['sql'], 'explanation' => $built['explanation'], 'explanation_i18n' => $built['explanation_i18n']]);
        case 'query':
            $keys = array_keys($input);
            sort($keys);
            if ($keys === ['sql'] || $keys === ['confirm', 'sql']) {
                if (array_key_exists('confirm', $input) && !is_bool($input['confirm'])) {
                    throw ApiException::fromCode('query_confirmation_invalid', 422);
                }
                Http::json((new QueryRunner($database))->executeScript(Http::text($input, 'sql'), ($input['confirm'] ?? false) === true));
            }
            if ($keys === ['design']) {
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
