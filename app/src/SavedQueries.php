<?php
declare(strict_types=1);

namespace Govern;

use PDOException;

final class SavedQueries
{
    private const SELECT = 'SELECT id, name, query_text AS `sql`, notes, updated_at FROM `_govern_queries`';

    public function __construct(private readonly Database $database, private readonly array $config) {}

    public function list(): array
    {
        try {
            return $this->database->reader()->query(self::SELECT . ' ORDER BY updated_at DESC, id DESC')->fetchAll();
        } catch (PDOException $exception) {
            if ((int) ($exception->errorInfo[1] ?? 0) === 1146) {
                return [];
            }
            throw $exception;
        }
    }

    public function save(array $input): array
    {
        $name = Http::text($input, 'name');
        $sql = Http::text($input, 'sql');
        $notes = Http::text($input, 'notes', false);
        if (preg_match_all('/./us', $name) > 160) {
            throw new ApiException('Geef het onderzoek een naam van maximaal 160 tekens.');
        }
        if (strlen($sql) > 262144 || strlen($notes) > 65535) {
            throw new ApiException('De query of toelichting is te groot.', 413);
        }
        $pdo = $this->database->writer();
        $this->ensureTable();
        $id = isset($input['id']) && $input['id'] !== '' && $input['id'] !== null ? self::id($input['id']) : null;
        if ($id !== null) {
            $existing = $pdo->prepare('SELECT id FROM `_govern_queries` WHERE id=:id');
            $existing->execute(['id' => $id]);
            if ($existing->fetchColumn() === false) {
                throw new ApiException('Dit opgeslagen onderzoek bestaat niet meer.', 404);
            }
            $statement = $pdo->prepare('UPDATE `_govern_queries` SET name=:name, query_text=:sql, notes=:notes WHERE id=:id');
            $statement->execute(['name' => $name, 'sql' => $sql, 'notes' => $notes, 'id' => $id]);
        } else {
            $statement = $pdo->prepare('INSERT INTO `_govern_queries` (name,query_text,notes) VALUES (:name,:sql,:notes)');
            $statement->execute(['name' => $name, 'sql' => $sql, 'notes' => $notes]);
            $id = $pdo->lastInsertId();
        }
        $statement = $pdo->prepare(self::SELECT . ' WHERE id=:id');
        $statement->execute(['id' => $id]);
        return $statement->fetch();
    }

    public function delete(mixed $id): array
    {
        $id = self::id($id);
        $statement = $this->database->writer()->prepare('DELETE FROM `_govern_queries` WHERE id=:id');
        $statement->execute(['id' => $id]);
        if ($statement->rowCount() === 0) {
            throw new ApiException('Dit opgeslagen onderzoek bestaat niet meer.', 404);
        }
        return ['deleted' => $id];
    }

    private function ensureTable(): void
    {
        $statement = $this->database->writer()->prepare(
            "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=:schema AND TABLE_NAME='_govern_queries'"
        );
        $statement->execute(['schema' => $this->database->name()]);
        if ((int) $statement->fetchColumn() !== 0) {
            return;
        }
        $file = $this->config['schema_file'];
        if (!is_file($file) || !is_readable($file)) {
            throw new ApiException('De definitie voor opgeslagen onderzoeken ontbreekt in de installatie.', 503);
        }
        $sql = file_get_contents($file);
        if ($sql === false || $sql === '') {
            throw new ApiException('De definitie voor opgeslagen onderzoeken kan niet worden gelezen.', 503);
        }
        $this->database->writer()->exec($sql);
    }

    private static function id(mixed $value): string
    {
        if ((!is_string($value) && !is_int($value)) || preg_match('/^[1-9][0-9]{0,19}$/D', (string) $value) !== 1) {
            throw new ApiException('Kies een geldig opgeslagen onderzoek.');
        }
        return (string) $value;
    }
}
