<?php
declare(strict_types=1);
namespace Govern;

/** One durable attempt; an interrupted attempt is never automatically replayed. */
final class ImportWorkflowRunner
{
    private float $deadline=0;
    public function __construct(private readonly array $base, private readonly ImportWorkflowStore $store,
        private readonly DatabaseProvisioner $provisioner, private readonly \Closure $accountCheck) {}

    public function execute(array $job): void
    {
        $this->deadline=microtime(true)+300;
        $completed = [];
        try {
            if (!(($this->accountCheck)((int) $job['initiated_by']))) throw ApiException::fromCode('workflow_account_inactive', 403);
            $record = $this->store->one('SELECT body FROM plans WHERE id=?', [$job['plan_id']]);
            if ($record === null) throw ApiException::fromCode('workflow_plan_changed', 409);
            $plan = ImportWorkflowStore::decode($record['body']);
            $parsed = null; $sql = null;
            if ($plan['source_id'] !== null) {
                $source = $this->source($plan['source_id'], $plan['source_sha256']);
                if ($plan['kind'] === 'dataset') {
                    $parsed = DatasetImport::read(['name' => $source['name'], 'tmp_name' => $this->path($source['source_id'])], $source['settings']);
                    DatasetMapping::normalize($parsed, $plan['tables']);
                } else {
                    $sql = (string) file_get_contents($this->path($source['source_id']));
                    ImportBackupSql::analyze($sql, $plan['engine']);
                }
            }
            $this->checkStop($job);
            if (!(($this->accountCheck)((int) $job['initiated_by']))) throw ApiException::fromCode('workflow_account_inactive', 403);
            $config = $this->target($plan, $job);
            $this->checkStop($job);
            if (!(($this->accountCheck)((int) $job['initiated_by']))) throw ApiException::fromCode('workflow_account_inactive', 403);
            $database = new Database($config);
            if ($plan['kind'] === 'dataset') {
                $mapping = new DatasetMapping($database);
                $tables = $mapping->prepare($parsed, $plan['tables']);
                $job['state'] = $job['stage'] = 'importing'; $job['unit_kind'] = 'rows'; $this->save($job, 'import_started');
                $job['result'] = $mapping->execute($parsed, $tables, function (array $table, array $all) use (&$job, &$completed): void {
                    $completed = $all; $job['completed_units'] = array_sum(array_column($all, 'imported'));
                    $job['result'] = ['tables' => $all, 'imported' => $job['completed_units']];
                    $this->save($job, 'table_committed'); $this->checkStop($job);
                }, function (): void {
                    $this->store->heartbeat();
                    if (microtime(true)>$this->deadline) throw ApiException::fromCode('workflow_time_limit',503);
                });
            } elseif ($plan['kind'] === 'backup') {
                $job['state'] = $job['stage'] = 'importing'; $job['unit_kind'] = 'statements'; $this->save($job, 'import_started');
                $this->backup($database, $sql, $job);
            }
            $job['state'] = $job['stage'] = 'verifying'; $this->save($job, 'verification_started');
            $database->discardReader();
            $verified = (new Catalog($database))->tables();
            if ($plan['kind']==='dataset') foreach ($plan['tables'] as $expected) {
                if (!in_array($expected['table'],array_column($verified,'name'),true)) throw ApiException::fromCode('workflow_plan_changed',409);
                if ($expected['mode']==='create') {
                    $qualified=$database->quoteIdentifier($database->schemaName()).'.'.$database->quoteIdentifier($expected['table']);
                    $count=(int)$database->reader()->query('SELECT COUNT(*) FROM '.$qualified)->fetchColumn();
                    if ($count!==$parsed['datasets'][$expected['dataset']]['count']) throw ApiException::fromCode('workflow_plan_changed',409);
                }
            }
            $job['result'] = [...($job['result'] ?? []), 'verified_tables' => array_column($verified, 'name'),
                'database' => $job['database'], 'scope_key' => $job['scope_key'], 'verified_at' => gmdate('c')];
            $job['state'] = $job['stage'] = 'completed'; $this->save($job, 'verified_completion');
        } catch (ImportWorkflowStop) {
            $job['state'] = $job['stage'] = ($completed !== [] || ($job['committed_import_effects'] ?? false)) ? 'partial' : 'cancelled';
            $job['error_code'] = null; $this->save($job, 'stop_confirmed');
        } catch (DatasetMappingException $exception) {
            $completed = $exception->completedTables;
            $job['completed_units'] = array_sum(array_column($completed, 'imported'));
            $job['result'] = ['tables' => $completed, 'imported' => $job['completed_units']];
            $job['state'] = $job['stage'] = $exception->uncertain ? 'unknown' : ($completed !== [] ? 'partial' : 'failed');
            $previous = $exception->getPrevious();
            $job['error_code'] = $previous instanceof ApiException ? $previous->errorCode : 'workflow_import_failed';
            if ($previous instanceof \PDOException) $job['diagnostics']=$this->diagnostics($previous,$job);
            $this->save($job, 'dataset_stopped');
        } catch (\Throwable $exception) {
            $uncertain = $exception instanceof \PDOException && $this->connectionLost($exception)
                || $exception instanceof ApiException && $exception->errorCode === 'database_creation_uncertain'
                || $job['stage'] === 'verifying';
            $job['state'] = $job['stage'] = $uncertain ? 'unknown'
                : (($completed !== [] || ($job['committed_import_effects'] ?? false)) ? 'partial' : 'failed');
            $job['error_code'] = $exception instanceof ApiException ? $exception->errorCode : 'workflow_import_failed';
            if ($exception instanceof \PDOException) $job['diagnostics']=$this->diagnostics($exception,$job);
            $this->save($job, 'execution_stopped');
        }
        if (in_array($job['state'], ['completed','partial','failed','cancelled'], true) && isset($plan['source_id'])) {
            $this->store->execute('UPDATE sources SET expires_at=MIN(uploaded_at+604800,?) WHERE id=?', [time()+ImportWorkflow::SOURCE_SECONDS,$plan['source_id']]);
        }
    }

    private function target(array $plan, array &$job): array
    {
        if ($plan['target_mode'] !== 'new_database') {
            $config = (new ConnectionScope($this->base))->selectRequest($plan['scope_key']);
            if ($config['engine'] !== $plan['engine'] || $config['name'] !== $plan['name']) throw ApiException::fromCode('workflow_plan_changed',409);
            return $config;
        }
        $receipt = $this->provisioner->create(['name'=>$plan['name'],'engine'=>$plan['engine'],'operation_id'=>$job['id']]);
        $job['created_database'] = true; $this->save($job,'database_created');
        $root = rtrim($this->base['backup_dir'],DIRECTORY_SEPARATOR);
        $config = [...$this->base,...($plan['engine']==='postgres'?$this->base['postgres']:[]),
            'engine'=>$plan['engine'],'connection'=>$plan['engine'],'name'=>$plan['name'],
            'schema'=>$plan['engine']==='postgres'?$plan['schema']:$plan['name'],'scope_key'=>$plan['scope_key'],
            'maintenance_dir'=>$root,'backup_dir'=>$root.'/connections/'.hash('sha256',$plan['scope_key'])];
        if ($plan['kind'] !== 'empty') {
            if (!is_string($receipt['import_user']??null)||!is_string($receipt['import_password']??null)||$receipt['import_user']===''||$receipt['import_password']==='') throw ApiException::fromCode('workflow_import_credentials',503);
            if ($plan['engine']==='postgres') {
                $config['sql_user']=$receipt['import_user']; $config['sql_password']=$receipt['import_password'];
            } else { $config['user']=$receipt['import_user']; $config['password']=$receipt['import_password']; }
        }
        return $config;
    }

    private function backup(Database $database,string $sql,array &$job): void
    {
        $sql=ImportBackupSql::text($sql); $pdo=$database->scriptConnection();
        $offset=0; $delimiter=';'; $line=1; $standard=true; $mode=Database::SQL_MODE;
        $pending=false; $started=microtime(true);
        try {
            while (true) {
                $this->checkStop($job);
                if (microtime(true)-$started>300) throw ApiException::fromCode('workflow_time_limit',503);
                $statement=$database->engine()==='postgres'?PostgresSqlScript::next($sql,$offset,$standard,$line):SqlScript::next($sql,$offset,$delimiter,$mode);
                if ($statement===null) break;
                $this->store->heartbeat();
                $job['statement_line']=(int)$statement['line'];
                $pdo->exec($database->engine()==='postgres'?"SET statement_timeout = '5s'":'SET SESSION max_statement_time = 5');
                $before=$pdo->inTransaction();
                $result=$pdo->query($statement['sql']); $affected=$result->rowCount(); $result->closeCursor();
                $after=$pdo->inTransaction(); $clean=trim($statement['clean']);
                if (preg_match('/\AROLLBACK\b/i',$clean)) $pending=false;
                elseif (preg_match('/\ACOMMIT\b/i',$clean)||$before&&!$after) {
                    if ($pending) $job['committed_import_effects']=true;
                    $pending=false;
                }
                $ddl=preg_match('/\A(?:CREATE|ALTER|DROP|TRUNCATE|RENAME)\b/i',$clean)===1;
                $data=preg_match('/\A(?:INSERT|UPDATE|DELETE|REPLACE)\b/i',$clean)===1&&$affected>0;
                $sequence=preg_match('/\ASELECT\s+(?:pg_catalog\.)?setval\s*\(/i',$clean)===1;
                if ($sequence||($ddl||$data)&&!$after) $job['committed_import_effects']=true;
                elseif ($ddl||$data) $pending=true;
                $job['completed_units']++;
                $job['result']=['executed_statements'=>$job['completed_units'],'imported'=>null,'tables'=>[]];
                $this->save($job,'statement_completed');
                if ($database->engine()==='postgres') $standard=$pdo->query('SHOW standard_conforming_strings')->fetchColumn()==='on';
                else { $literal=SqlScript::literalSqlMode($statement['sql'],$mode); if ($literal!==null) $mode=$literal; }
            }
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
                if ($pending) throw ApiException::fromCode('workflow_uncommitted',409);
            }
        } finally { if ($pdo->inTransaction()) $pdo->rollBack(); }
    }
    private function path(string $id): string { return $this->store->directory.'/'.ImportWorkflowStore::id($id).'.source'; }
    private function source(string $id,string $hash): array
    {
        $record=$this->store->one('SELECT * FROM sources WHERE id=?',[$id]);
        if ($record===null||$record['deleted_at']!==null||(int)$record['expires_at']<time()+300
            || (int)$record['uploaded_at']+604800<time()+300
            ||!is_file($this->path($id))||is_link($this->path($id))) throw ApiException::fromCode('workflow_expired',409);
        $source=ImportWorkflowStore::decode($record['body']);
        if (!hash_equals($source['sha256'],$hash)||!hash_equals($hash,(string)hash_file('sha256',$this->path($id)))) throw ApiException::fromCode('workflow_plan_changed',409);
        return $source;
    }
    private function checkStop(array &$job): void
    {
        if (microtime(true)>$this->deadline) throw ApiException::fromCode('workflow_time_limit',503);
        $record=$this->store->one('SELECT body FROM jobs WHERE id=?',[$job['id']]);
        if ($record!==null&&ImportWorkflowStore::decode($record['body'])['stop_requested']) {
            $job['stop_requested']=true; throw new ImportWorkflowStop();
        }
    }
    private function save(array &$job,string $event): void
    {
        $job['action_required']=in_array($job['state'],['partial','unknown'],true)||$job['created_database']&&in_array($job['state'],['failed','cancelled'],true);
        $job['updated_at']=gmdate('c'); $this->store->record($job,$event); $this->store->heartbeat();
    }
    private function connectionLost(\PDOException $exception): bool
    {
        return str_starts_with((string)$exception->getCode(),'08')||in_array((int)($exception->errorInfo[1]??0),[2006,2013,2055],true);
    }
    private function diagnostics(\PDOException $exception,array $job): array
    {
        $state=(string)$exception->getCode();
        return ['sqlstate'=>preg_match('/\A[A-Z0-9]{5}\z/D',$state)?$state:null,
            'driver_code'=>is_numeric($exception->errorInfo[1]??null)?(int)$exception->errorInfo[1]:null,
            'statement_line'=>$job['statement_line']??null,
            'completed_statements'=>$job['unit_kind']==='statements'?$job['completed_units']:null];
    }
}
final class ImportWorkflowStop extends \RuntimeException {}
