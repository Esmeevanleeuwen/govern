<?php
declare(strict_types=1);

namespace Govern;

use PDO;
use PDOException;

/** Persistent whiteboards and immutable speech sources in the selected PostgreSQL schema. */
final class StudioService
{
    public const MAX_BOARDS = 200;
    public const MAX_NODES = 500;
    public const MAX_EDGES = 1000;
    public const MAX_SEGMENTS = 2000;
    public const MAX_RECORDINGS = 100;
    public const MAX_CHANGES = 100;
    private const CONTENT_BYTES = 4194304;
    private const SIGNATURE = 'govern-studio-foundation-v1';

    public function __construct(private readonly Database $database, private readonly array $config)
    {
        if (($config['studio']['enabled'] ?? false) !== true) throw ApiException::fromCode('studio_disabled', 403);
        if ($database->engine() !== 'postgres' || $database->schemaName() !== ($config['studio']['schema'] ?? null)
            || !in_array($database->schemaName(), $config['schemas'] ?? [], true)) {
            throw ApiException::fromCode('studio_config_invalid', 503);
        }
    }

    public function ready(): bool
    {
        try {
            $q = $this->database->reader()->query('SELECT version, signature FROM ' . $this->table('migrations') . ' ORDER BY version');
            $rows = $q->fetchAll();
            if (count($rows) !== 1 || (int) $rows[0]['version'] !== 1 || $rows[0]['signature'] !== self::SIGNATURE) return false;
            foreach (['boards', 'nodes', 'edges', 'recordings', 'segments', 'operations'] as $table) {
                $this->database->reader()->query('SELECT 1 FROM ' . $this->table($table) . ' LIMIT 0');
            }
            return true;
        } catch (PDOException $exception) {
            if (in_array($exception->getCode(), ['42P01', '3F000'], true)) return false;
            throw $exception;
        }
    }

    /** Restoring Govern's schema recreates the table; its new OID invalidates old clients. */
    public function generation(): string
    {
        $this->requireReady();
        return $this->currentGeneration($this->database->reader());
    }

    public function boards(): array
    {
        $this->requireReady();
        $rows = $this->database->reader()->query('SELECT id, title, revision, created_at, updated_at FROM ' . $this->table('boards')
            . ' ORDER BY updated_at DESC, id LIMIT ' . (self::MAX_BOARDS + 1))->fetchAll();
        if (count($rows) > self::MAX_BOARDS) throw ApiException::fromCode('studio_limit', 422);
        return array_map($this->boardRecord(...), $rows);
    }

    public function createBoard(array $input): array
    {
        $this->shape($input, ['id', 'title', 'operation_id', 'generation']);
        $id = $this->uuid($input['id'] ?? null);
        $title = $this->text($input['title'] ?? null, 300, false);
        $operation = $this->uuid($input['operation_id'] ?? null);
        $hash = $this->hash(['id' => $id, 'title' => $title]);
        return $this->transaction($input, function (PDO $pdo) use ($id, $title, $operation, $hash): array {
            $this->operationLock($pdo, $operation);
            if (($response = $this->replay($pdo, $operation, 'create-board', $id, $hash)) !== null) return $response;
            // The migration-level key serializes creation limits, including different operation IDs.
            $this->operationLock($pdo, 'studio-board-creation');
            if ((int) $pdo->query('SELECT count(*) FROM ' . $this->table('boards'))->fetchColumn() >= self::MAX_BOARDS) {
                throw ApiException::fromCode('studio_limit', 422);
            }
            $q = $pdo->prepare('INSERT INTO ' . $this->table('boards') . ' (id,title) VALUES (:id,:title) RETURNING id,title,revision,created_at,updated_at');
            $q->execute(['id' => $id, 'title' => $title]);
            $response = $this->boardRecord($q->fetch());
            $this->remember($pdo, $operation, 'create-board', $id, $hash, $response);
            return $response;
        });
    }

    public function board(string $id): array
    {
        $id = $this->uuid($id);
        $this->requireReady();
        $pdo = $this->database->reader();
        $pdo->beginTransaction();
        try {
            $pdo->exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
            $board = $this->readBoard($pdo, $id);
            $this->checkLimits($pdo, $id);
            $nodes = $this->select($pdo, 'SELECT id,kind,text,x,y,width,height,data,version,source_segment_id,created_at,updated_at FROM '
                . $this->table('nodes') . ' WHERE board_id=:board ORDER BY created_at,id', ['board' => $id]);
            foreach ($nodes as &$node) {
                foreach (['x', 'y', 'width', 'height'] as $key) $node[$key] = (float) $node[$key];
                $node['version'] = (int) $node['version'];
                $node['data'] = json_decode($node['data'], false, 32, JSON_THROW_ON_ERROR);
            }
            unset($node);
            $edges = $this->select($pdo, 'SELECT id,from_node_id,to_node_id,label FROM ' . $this->table('edges')
                . ' WHERE board_id=:board ORDER BY created_at,id', ['board' => $id]);
            $segments = $this->select($pdo, $this->segmentSql() . ' WHERE s.board_id=:board ORDER BY r.created_at,s.sequence,s.id', ['board' => $id]);
            $segments = array_map($this->segmentRecord(...), $segments);
            $recordings = $this->select($pdo, 'SELECT id,status,created_at,stopped_at FROM ' . $this->table('recordings')
                . ' WHERE board_id=:board ORDER BY created_at,id', ['board' => $id]);
            $result = ['generation' => $this->currentGeneration($pdo), 'board' => $this->boardRecord($board), 'nodes' => $nodes,
                'edges' => $edges, 'segments' => $segments, 'recordings' => $recordings];
            $pdo->commit();
            return $result;
        } catch (\Throwable $exception) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $exception;
        }
    }

    public function mutate(array $input): array
    {
        $this->shape($input, ['board_id', 'base_revision', 'operation_id', 'generation', 'changes']);
        $board = $this->uuid($input['board_id'] ?? null);
        $revision = $this->integer($input['base_revision'] ?? null, 0, 9007199254740991);
        $operation = $this->uuid($input['operation_id'] ?? null);
        $changes = $input['changes'] ?? null;
        if (!is_array($changes) || !array_is_list($changes) || count($changes) < 1 || count($changes) > self::MAX_CHANGES) $this->invalid();
        $changes = array_map($this->change(...), $changes);
        $hash = $this->hash(['board_id' => $board, 'base_revision' => $revision, 'changes' => $changes]);
        return $this->transaction($input, function (PDO $pdo) use ($board, $revision, $operation, $changes, $hash): array {
            $this->operationLock($pdo, $operation);
            if (($response = $this->replay($pdo, $operation, 'mutate', $board, $hash)) !== null) return $response;
            $current = $this->readBoard($pdo, $board, true);
            if ((int) $current['revision'] !== $revision) throw ApiException::fromCode('studio_revision_conflict', 409);
            foreach ($changes as $change) $this->applyChange($pdo, $board, $change);
            $this->checkLimits($pdo, $board);
            $response = ['revision' => $this->bump($pdo, $board), 'operation_id' => $operation];
            $this->remember($pdo, $operation, 'mutate', $board, $hash, $response);
            return $response;
        });
    }

    public function startRecording(array $input): array
    {
        $this->shape($input, ['id', 'board_id', 'operation_id', 'generation']);
        $id = $this->uuid($input['id'] ?? null);
        $board = $this->uuid($input['board_id'] ?? null);
        $operation = $this->uuid($input['operation_id'] ?? null);
        $hash = $this->hash(['id' => $id, 'board_id' => $board]);
        return $this->transaction($input, function (PDO $pdo) use ($id, $board, $operation, $hash): array {
            $this->operationLock($pdo, $operation);
            if (($response = $this->replay($pdo, $operation, 'start-recording', $board, $hash)) !== null) return $response;
            $this->readBoard($pdo, $board, true);
            $q = $pdo->prepare('INSERT INTO ' . $this->table('recordings') . ' (board_id,id) VALUES (:board,:id)');
            $q->execute(['board' => $board, 'id' => $id]);
            $this->checkLimits($pdo, $board);
            $response = ['id' => $id, 'board_id' => $board, 'status' => 'recording', 'revision' => $this->bump($pdo, $board)];
            $this->remember($pdo, $operation, 'start-recording', $board, $hash, $response);
            return $response;
        });
    }

    public function stopRecording(array $input): array
    {
        $this->shape($input, ['id', 'board_id', 'generation']);
        $id = $this->uuid($input['id'] ?? null);
        $board = $this->uuid($input['board_id'] ?? null);
        return $this->transaction($input, function (PDO $pdo) use ($id, $board): array {
            $current = $this->readBoard($pdo, $board, true);
            $recording = $this->recording($pdo, $board, $id, true);
            $revision = (int) $current['revision'];
            if ($recording['status'] !== 'stopped') {
                $q = $pdo->prepare('UPDATE ' . $this->table('recordings') . " SET status='stopped',stopped_at=clock_timestamp() WHERE board_id=:board AND id=:id");
                $q->execute(['board' => $board, 'id' => $id]);
                $revision = $this->bump($pdo, $board);
            }
            return ['id' => $id, 'status' => 'stopped', 'revision' => $revision];
        });
    }

    public function findSegment(string $boardId, string $recordingId, int $sequence): ?array
    {
        $boardId = $this->uuid($boardId);
        $recordingId = $this->uuid($recordingId);
        $sequence = $this->integer($sequence, 0, 10000);
        $this->requireReady();
        $this->readBoard($this->database->reader(), $boardId);
        $this->recording($this->database->reader(), $boardId, $recordingId);
        return $this->findSegmentWith($this->database->reader(), $boardId, $recordingId, $sequence);
    }

    /** Cheap validation and replay lookup before a provider receives any microphone data. */
    public function prepareAudio(array $input): ?array
    {
        $this->shape($input, ['board_id', 'recording_id', 'sequence', 'start_ms', 'end_ms', 'operation_id', 'generation', 'sha256']);
        $board = $this->uuid($input['board_id'] ?? null);
        $recording = $this->uuid($input['recording_id'] ?? null);
        $operation = $this->uuid($input['operation_id'] ?? null);
        $sequence = $this->integer($input['sequence'] ?? null, 0, 10000);
        $start = $this->integer($input['start_ms'] ?? null, 0, 86400000);
        $end = $this->integer($input['end_ms'] ?? null, 1, 86400000);
        $sha = $input['sha256'] ?? null;
        if ($end <= $start || $end - $start > 12000 || !is_string($sha) || !preg_match('/\A[0-9a-f]{64}\z/D', $sha)) $this->invalid();
        return $this->audioTransaction($input, function (PDO $pdo) use ($board, $recording, $operation, $sequence, $start, $end, $sha): ?array {
            $this->readBoard($pdo, $board, true);
            $source = $this->recording($pdo, $board, $recording, true);
            if (($existing = $this->findSegmentWith($pdo, $board, $recording, $sequence)) !== null) {
                if (!hash_equals($existing['sha256'], $sha) || $existing['start_ms'] !== $start || $existing['end_ms'] !== $end
                    || $existing['operation_id'] !== $operation) throw ApiException::fromCode('studio_segment_conflict', 409);
                $revision = $existing['revision'];
                unset($existing['revision']);
                return ['revision' => $revision, 'segment' => $existing, 'duplicate' => true];
            }
            // A different sequence/recording may reuse a completed operation ID.
            // Reject that before sending fresh microphone data to the provider.
            $q = $pdo->prepare('SELECT 1 FROM ' . $this->table('segments') . ' WHERE operation_id=:operation');
            $q->execute(['operation' => $operation]);
            if ($q->fetchColumn() !== false) throw ApiException::fromCode('studio_operation_conflict', 409);
            if ($source['status'] !== 'recording') throw ApiException::fromCode('studio_recording_stopped', 409);
            $this->checkTimeline($pdo, $board, $recording, $sequence, $start);
            $this->checkLimits($pdo, $board);
            return null;
        });
    }

    /** Called only after server-side transcription; this never rewrites existing user cards. */
    public function appendTranscript(array $input): array
    {
        $this->shape($input, ['board_id', 'recording_id', 'sequence', 'start_ms', 'end_ms', 'text', 'sha256', 'provider', 'generation', 'operation_id']);
        $board = $this->uuid($input['board_id'] ?? null);
        $recording = $this->uuid($input['recording_id'] ?? null);
        $sequence = $this->integer($input['sequence'] ?? null, 0, 10000);
        $operation = $this->uuid($input['operation_id'] ?? null);
        $start = $this->integer($input['start_ms'] ?? null, 0, 86400000);
        $end = $this->integer($input['end_ms'] ?? null, 1, 86400000);
        if ($end <= $start || $end - $start > 12000) $this->invalid();
        $text = $this->text($input['text'] ?? null, 8000);
        $provider = $this->text($input['provider'] ?? null, 128, false);
        $sha = $input['sha256'] ?? null;
        if (!is_string($sha) || !preg_match('/\A[0-9a-f]{64}\z/D', $sha)) $this->invalid();
        return $this->transaction($input, function (PDO $pdo) use ($board, $recording, $operation, $sequence, $start, $end, $text, $provider, $sha): array {
            $this->readBoard($pdo, $board, true);
            $source = $this->recording($pdo, $board, $recording, true);
            if (($existing = $this->findSegmentWith($pdo, $board, $recording, $sequence)) !== null) {
                if (!hash_equals($existing['sha256'], $sha) || $existing['start_ms'] !== $start || $existing['end_ms'] !== $end
                    || $existing['operation_id'] !== $operation) {
                    throw ApiException::fromCode('studio_segment_conflict', 409);
                }
                $revision = $existing['revision'];
                unset($existing['revision']);
                return ['revision' => $revision, 'segment' => $existing, 'duplicate' => true];
            }
            if ($source['status'] !== 'recording') throw ApiException::fromCode('studio_recording_stopped', 409);
            $this->checkTimeline($pdo, $board, $recording, $sequence, $start);
            $segment = self::newUuid();
            $q = $pdo->prepare('INSERT INTO ' . $this->table('segments') . ' (board_id,id,recording_id,sequence,start_ms,end_ms,text,sha256,provider,operation_id)'
                . ' VALUES (:board,:id,:recording,:sequence,:start,:end,:text,:sha,:provider,:operation)');
            $q->execute(['board' => $board, 'id' => $segment, 'recording' => $recording, 'sequence' => $sequence,
                'start' => $start, 'end' => $end, 'text' => $text, 'sha' => $sha, 'provider' => $provider, 'operation' => $operation]);
            if ($text !== '') {
                $q = $pdo->prepare('SELECT count(*) FROM ' . $this->table('nodes') . ' WHERE board_id=:board');
                $q->execute(['board' => $board]);
                $count = (int) $q->fetchColumn();
                $q = $pdo->prepare('INSERT INTO ' . $this->table('nodes')
                    . " (board_id,id,kind,text,x,y,width,height,data,source_segment_id) VALUES (:board,:id,'note',:text,:x,:y,280,200,'{}'::jsonb,:source)");
                $q->execute(['board' => $board, 'id' => $segment, 'text' => $text,
                    'x' => 48 + ($count % 4) * 320, 'y' => 48 + intdiv($count, 4) * 240, 'source' => $segment]);
            }
            $this->checkLimits($pdo, $board);
            $revision = $this->bump($pdo, $board);
            $saved = $this->findSegmentWith($pdo, $board, $recording, $sequence);
            unset($saved['revision']);
            return ['revision' => $revision, 'segment' => $saved, 'duplicate' => false];
        });
    }

    private function change(mixed $change): array
    {
        if (!is_array($change) || !is_string($change['type'] ?? null)) $this->invalid();
        switch ($change['type']) {
            case 'put-node':
                $this->shape($change, ['type', 'node']);
                return ['type' => 'put-node', 'node' => $this->node($change['node'] ?? null)];
            case 'put-edge':
                $this->shape($change, ['type', 'edge']);
                $edge = $change['edge'] ?? null;
                if (!is_array($edge)) $this->invalid();
                $this->shape($edge, ['id', 'from_node_id', 'to_node_id', 'label']);
                $normalized = ['id' => $this->uuid($edge['id'] ?? null), 'from_node_id' => $this->uuid($edge['from_node_id'] ?? null),
                    'to_node_id' => $this->uuid($edge['to_node_id'] ?? null), 'label' => $this->text($edge['label'] ?? '', 512)];
                if ($normalized['from_node_id'] === $normalized['to_node_id']) $this->invalid();
                return ['type' => 'put-edge', 'edge' => $normalized];
            case 'delete-node':
            case 'delete-edge':
                $this->shape($change, ['type', 'id']);
                return ['type' => $change['type'], 'id' => $this->uuid($change['id'] ?? null)];
            default:
                $this->invalid();
        }
    }

    private function node(mixed $node): array
    {
        if (!is_array($node)) $this->invalid();
        $this->shape($node, ['id', 'kind', 'text', 'x', 'y', 'width', 'height', 'data']);
        $kind = $node['kind'] ?? null;
        if (!in_array($kind, ['note', 'idea', 'screen', 'stroke'], true)) $this->invalid();
        $data = $node['data'] ?? [];
        if (is_object($data)) $data = (array) $data;
        if (!is_array($data) || ($data !== [] && array_is_list($data))) $this->invalid();
        if ($kind === 'stroke') {
            $this->shape($data, ['points', 'color', 'size']);
            $points = $data['points'] ?? null;
            if (!is_array($points) || !array_is_list($points) || count($points) < 2 || count($points) > 2000) $this->invalid();
            $data = ['points' => array_map(function (mixed $point): array {
                if (!is_array($point) || !array_is_list($point) || count($point) !== 2) $this->invalid();
                return [$this->number($point[0], -10000, 10000), $this->number($point[1], -10000, 10000)];
            }, $points), 'color' => $this->color($data['color'] ?? '#0b7476'), 'size' => $this->number($data['size'] ?? 3, 1, 32)];
        } elseif ($kind === 'screen') {
            $this->shape($data, ['layout']);
            if (!in_array($data['layout'] ?? 'form', ['form', 'dashboard', 'landing'], true)) $this->invalid();
            $data = ['layout' => $data['layout'] ?? 'form'];
        } else {
            $this->shape($data, ['color']);
            $data = isset($data['color']) ? ['color' => $this->color($data['color'])] : [];
        }
        return ['id' => $this->uuid($node['id'] ?? null), 'kind' => $kind,
            'text' => $this->text($node['text'] ?? '', 8000), 'x' => $this->number($node['x'] ?? null, -1000000, 1000000),
            'y' => $this->number($node['y'] ?? null, -1000000, 1000000),
            'width' => $this->number($node['width'] ?? null, $kind === 'stroke' ? 1 : 16, 10000),
            'height' => $this->number($node['height'] ?? null, $kind === 'stroke' ? 1 : 16, 10000), 'data' => $data];
    }

    private function applyChange(PDO $pdo, string $board, array $change): void
    {
        if ($change['type'] === 'put-node') {
            $node = $change['node'];
            $q = $pdo->prepare('INSERT INTO ' . $this->table('nodes') . ' (board_id,id,kind,text,x,y,width,height,data,source_segment_id)'
                . ' VALUES (:board,:id,:kind,:text,:x,:y,:width,:height,CAST(:data AS jsonb),'
                . '(SELECT s.id FROM ' . $this->table('segments') . " s WHERE s.board_id=:source_board AND s.id=:source_id AND :source_kind='note'))"
                . ' ON CONFLICT (board_id,id) DO UPDATE SET kind=EXCLUDED.kind,text=EXCLUDED.text,x=EXCLUDED.x,y=EXCLUDED.y,'
                . 'width=EXCLUDED.width,height=EXCLUDED.height,data=EXCLUDED.data,version=' . $this->table('nodes') . '.version+1,updated_at=clock_timestamp()');
            $node['data'] = json_encode((object) $node['data'], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            $q->execute(['board' => $board, ...$node, 'source_board' => $board, 'source_id' => $node['id'], 'source_kind' => $node['kind']]);
        } elseif ($change['type'] === 'put-edge') {
            $edge = $change['edge'];
            $q = $pdo->prepare('SELECT count(*) FROM ' . $this->table('nodes') . ' WHERE board_id=:board AND id IN (:first,:second)');
            $q->execute(['board' => $board, 'first' => $edge['from_node_id'], 'second' => $edge['to_node_id']]);
            if ((int) $q->fetchColumn() !== 2) throw ApiException::fromCode('studio_node_missing', 422);
            $q = $pdo->prepare('INSERT INTO ' . $this->table('edges') . ' (board_id,id,from_node_id,to_node_id,label)'
                . ' VALUES (:board,:id,:from_node_id,:to_node_id,:label) ON CONFLICT (board_id,id) DO UPDATE SET '
                . 'from_node_id=EXCLUDED.from_node_id,to_node_id=EXCLUDED.to_node_id,label=EXCLUDED.label');
            $q->execute(['board' => $board, ...$edge]);
        } else {
            $q = $pdo->prepare('DELETE FROM ' . $this->table($change['type'] === 'delete-node' ? 'nodes' : 'edges') . ' WHERE board_id=:board AND id=:id');
            $q->execute(['board' => $board, 'id' => $change['id']]);
        }
    }

    private function transaction(array $input, callable $work): array
    {
        return $this->audioTransaction($input, $work);
    }

    private function audioTransaction(array $input, callable $work): ?array
    {
        $this->requireReady();
        $pdo = $this->database->writer();
        $pdo->beginTransaction();
        try {
            $generation = $input['generation'] ?? null;
            if (!is_string($generation) || !hash_equals($this->currentGeneration($pdo), $generation)) {
                throw ApiException::fromCode('studio_generation_conflict', 409);
            }
            $result = $work($pdo);
            $pdo->commit();
            return $result;
        } catch (PDOException $exception) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            if ($exception->getCode() === '23505') throw ApiException::fromCode('studio_operation_conflict', 409);
            if ($exception->getCode() === '23503') throw ApiException::fromCode('studio_node_missing', 422);
            if ($exception->getCode() === '23514') throw ApiException::fromCode('studio_input_invalid', 422);
            if (in_array($exception->getCode(), ['55P03', '57014', '40P01', '40001'], true)) throw ApiException::fromCode('studio_busy', 423);
            throw $exception;
        } catch (\Throwable $exception) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $exception;
        }
    }

    private function currentGeneration(PDO $pdo): string
    {
        $q = $pdo->prepare('SELECT c.oid::text AS relation_oid,d.oid::text AS database_oid,m.installation_id FROM pg_catalog.pg_class c'
            . ' JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace CROSS JOIN pg_catalog.pg_database d CROSS JOIN '
            . $this->table('migrations') . ' m WHERE n.nspname=:schema AND c.relname=\'_govern_studio_boards\''
            . ' AND d.datname=current_database() AND m.version=1');
        $q->execute(['schema' => $this->database->schemaName()]);
        $row = $q->fetch();
        if (!$row) throw ApiException::fromCode('studio_schema_unavailable', 503);
        return hash('sha256', implode(':', [$row['database_oid'], $row['relation_oid'], $row['installation_id']]));
    }

    private function requireReady(): void
    {
        if (!$this->ready()) throw ApiException::fromCode('studio_schema_unavailable', 503);
    }

    private function readBoard(PDO $pdo, string $id, bool $lock = false): array
    {
        $q = $pdo->prepare('SELECT id,title,revision,created_at,updated_at FROM ' . $this->table('boards') . ' WHERE id=:id' . ($lock ? ' FOR UPDATE' : ''));
        $q->execute(['id' => $id]);
        $row = $q->fetch();
        if (!$row) throw ApiException::fromCode('studio_board_missing', 404);
        return $row;
    }

    private function recording(PDO $pdo, string $board, string $id, bool $lock = false): array
    {
        $q = $pdo->prepare('SELECT id,status FROM ' . $this->table('recordings') . ' WHERE board_id=:board AND id=:id' . ($lock ? ' FOR UPDATE' : ''));
        $q->execute(['board' => $board, 'id' => $id]);
        $row = $q->fetch();
        if (!$row) throw ApiException::fromCode('studio_recording_missing', 404);
        return $row;
    }

    private function segmentSql(): string
    {
        return 'SELECT s.id,s.recording_id,s.sequence,s.start_ms,s.end_ms,s.text,s.sha256,s.provider,s.operation_id,n.id AS node_id,b.revision'
            . ' FROM ' . $this->table('segments') . ' s JOIN ' . $this->table('boards') . ' b ON b.id=s.board_id'
            . ' JOIN ' . $this->table('recordings') . ' r ON r.board_id=s.board_id AND r.id=s.recording_id'
            . ' LEFT JOIN ' . $this->table('nodes') . ' n ON n.board_id=s.board_id AND n.source_segment_id=s.id';
    }

    private function findSegmentWith(PDO $pdo, string $board, string $recording, int $sequence): ?array
    {
        $q = $pdo->prepare($this->segmentSql() . ' WHERE s.board_id=:board AND s.recording_id=:recording AND s.sequence=:sequence');
        $q->execute(['board' => $board, 'recording' => $recording, 'sequence' => $sequence]);
        $row = $q->fetch();
        return $row ? $this->segmentRecord($row) : null;
    }

    private function checkTimeline(PDO $pdo, string $board, string $recording, int $sequence, int $start): void
    {
        $q = $pdo->prepare('SELECT sequence,end_ms FROM ' . $this->table('segments') . ' WHERE board_id=:board AND recording_id=:recording ORDER BY sequence DESC LIMIT 1');
        $q->execute(['board' => $board, 'recording' => $recording]);
        $last = $q->fetch();
        if (($last === false && ($sequence !== 0 || $start !== 0))
            || ($last !== false && ($sequence !== (int) $last['sequence'] + 1 || $start !== (int) $last['end_ms']))) {
            throw ApiException::fromCode('studio_segment_conflict', 409);
        }
    }

    private function checkLimits(PDO $pdo, string $board): void
    {
        $bytes = 0;
        foreach (['nodes' => self::MAX_NODES, 'edges' => self::MAX_EDGES, 'segments' => self::MAX_SEGMENTS, 'recordings' => self::MAX_RECORDINGS] as $table => $limit) {
            $q = $pdo->prepare('SELECT count(*) AS count'
                . ($table === 'nodes' ? ',COALESCE(sum(octet_length(text)+octet_length(data::text)),0) AS bytes' : ($table === 'segments' ? ',COALESCE(sum(octet_length(text)),0) AS bytes' : ''))
                . ' FROM ' . $this->table($table) . ' WHERE board_id=:board');
            $q->execute(['board' => $board]);
            $row = $q->fetch();
            if ((int) $row['count'] > $limit) throw ApiException::fromCode('studio_limit', 422);
            $bytes += (int) ($row['bytes'] ?? 0);
        }
        if ($bytes > self::CONTENT_BYTES) throw ApiException::fromCode('studio_limit', 422);
    }

    private function bump(PDO $pdo, string $board): int
    {
        $q = $pdo->prepare('UPDATE ' . $this->table('boards') . ' SET revision=revision+1,updated_at=clock_timestamp() WHERE id=:board RETURNING revision');
        $q->execute(['board' => $board]);
        return (int) $q->fetchColumn();
    }

    private function operationLock(PDO $pdo, string $operation): void
    {
        $q = $pdo->prepare('SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(:operation,0))');
        $q->execute(['operation' => $this->database->schemaName() . ':' . $operation]);
    }

    private function replay(PDO $pdo, string $operation, string $kind, string $board, string $hash): ?array
    {
        $q = $pdo->prepare('SELECT kind,board_id,request_hash,response FROM ' . $this->table('operations') . ' WHERE id=:id');
        $q->execute(['id' => $operation]);
        $row = $q->fetch();
        if (!$row) return null;
        if ($row['kind'] !== $kind || $row['board_id'] !== $board || !hash_equals($row['request_hash'], $hash)) {
            throw ApiException::fromCode('studio_operation_conflict', 409);
        }
        return json_decode($row['response'], true, 32, JSON_THROW_ON_ERROR);
    }

    private function remember(PDO $pdo, string $operation, string $kind, string $board, string $hash, array $response): void
    {
        $q = $pdo->prepare('INSERT INTO ' . $this->table('operations') . ' (id,board_id,kind,request_hash,response) VALUES (:id,:board,:kind,:hash,CAST(:response AS jsonb))');
        $q->execute(['id' => $operation, 'board' => $board, 'kind' => $kind, 'hash' => $hash,
            'response' => json_encode($response, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]);
    }

    private function boardRecord(array $row): array
    {
        $row['revision'] = (int) $row['revision'];
        return $row;
    }

    private function segmentRecord(array $row): array
    {
        foreach (['sequence', 'start_ms', 'end_ms', 'revision'] as $key) if (array_key_exists($key, $row)) $row[$key] = (int) $row[$key];
        return $row;
    }

    private function table(string $suffix): string
    {
        return $this->database->quoteIdentifier($this->database->schemaName()) . '.' . $this->database->quoteIdentifier('_govern_studio_' . $suffix);
    }

    private function select(PDO $pdo, string $sql, array $params): array
    {
        $q = $pdo->prepare($sql);
        $q->execute($params);
        return $q->fetchAll();
    }

    private function shape(array $value, array $allowed): void
    {
        if (array_diff(array_keys($value), $allowed) !== []) $this->invalid();
    }

    private function uuid(mixed $value): string
    {
        if (!is_string($value) || preg_match('/\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/Di', $value) !== 1) $this->invalid();
        return strtolower($value);
    }

    private function text(mixed $value, int $max, bool $empty = true): string
    {
        if (!is_string($value) || strlen($value) > $max || preg_match('//u', $value) !== 1 || str_contains($value, "\0")) $this->invalid();
        if (!$empty && trim($value) === '') $this->invalid();
        return $value;
    }

    private function integer(mixed $value, int $minimum, int $maximum): int
    {
        if (is_string($value) && preg_match('/\A(?:0|[1-9][0-9]{0,15})\z/D', $value)) $value = (int) $value;
        if (!is_int($value) || $value < $minimum || $value > $maximum) $this->invalid();
        return $value;
    }

    private function number(mixed $value, float $minimum, float $maximum): float
    {
        if ((!is_int($value) && !is_float($value)) || !is_finite((float) $value) || $value < $minimum || $value > $maximum) $this->invalid();
        return (float) $value;
    }

    private function color(mixed $value): string
    {
        if (!is_string($value) || preg_match('/\A#[0-9a-f]{6}\z/Di', $value) !== 1) $this->invalid();
        return strtolower($value);
    }

    private function hash(array $value): string
    {
        return hash('sha256', json_encode($value, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION));
    }

    private function invalid(): never
    {
        throw ApiException::fromCode('studio_input_invalid', 422);
    }

    public static function newUuid(): string
    {
        $bytes = random_bytes(16);
        $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
        $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
        $hex = bin2hex($bytes);
        return substr($hex, 0, 8) . '-' . substr($hex, 8, 4) . '-' . substr($hex, 12, 4) . '-' . substr($hex, 16, 4) . '-' . substr($hex, 20);
    }
}
