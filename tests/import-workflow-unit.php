<?php
declare(strict_types=1);
$application = dirname(__DIR__).'/app';
if (!is_file($application.'/importers/tabular.py') && is_file('/var/www/importers/tabular.py')) $application='/var/www';
require_once $application.'/src/bootstrap.php';
use Govern\ApiException;
use Govern\Config;
use Govern\DatabaseProvisioner;
use Govern\ImportBackupSql;
use Govern\ImportWorkflow;
use Govern\ImportWorkflowStore;
$checks=0;
function check(bool $condition,string $message): void { global $checks; $checks++; if(!$condition) throw new RuntimeException($message); }
function rejects(callable $run,string $code): void {
    try { $run(); throw new RuntimeException('Expected '.$code); }
    catch(ApiException $e) { check($e->errorCode===$code,'Expected '.$code.', received '.$e->errorCode); }
}
check(ImportBackupSql::inspect('CREATE TABLE contacts (name TEXT);')['requires_engine'],'Ambiguous SQL needs source engine');
check(ImportBackupSql::inspect("-- PostgreSQL database dump\nCREATE TABLE contacts (name TEXT);")['engine']==='postgres','PostgreSQL evidence');
check(ImportBackupSql::inspect('CREATE TABLE contacts (name TEXT) ENGINE=InnoDB;')['engine']==='mariadb','MariaDB evidence');
check(ImportBackupSql::inspect('PGDMParchive')['blocked'],'Custom archive blocked');
check(ImportBackupSql::analyze("CREATE TABLE contacts (name TEXT); INSERT INTO contacts VALUES ('00123');",'mariadb')['statement_count']===2,'Plain SQL supported');
check(ImportBackupSql::analyze('CREATE TABLE public.contacts (name text);','postgres')['statement_count']===1,'PostgreSQL public schema');
rejects(fn()=>ImportBackupSql::analyze('USE original;','mariadb'),'workflow_backup_qualified');
rejects(fn()=>ImportBackupSql::analyze('INSERT INTO original.contacts VALUES (1);','mariadb'),'workflow_backup_qualified');
rejects(fn()=>ImportBackupSql::analyze('CREATE TABLE other.contacts (name text);','postgres'),'workflow_backup_qualified');
rejects(fn()=>ImportBackupSql::analyze('CREATE TABLE source_db.public.contacts (name text);','postgres'),'workflow_backup_qualified');
rejects(fn()=>ImportBackupSql::analyze('CREATE DATABASE original;','postgres'),'workflow_backup_qualified');
rejects(fn()=>ImportBackupSql::analyze('CREATE FUNCTION fn() RETURNS int RETURN 1;','mariadb'),'workflow_backup_unsupported');
rejects(fn()=>ImportBackupSql::text(str_repeat('x',262145)),'workflow_backup_unsupported');
rejects(fn()=>ImportWorkflowStore::id('../../private'),'workflow_invalid');
$dir=sys_get_temp_dir().'/govern-workflow-unit-'.bin2hex(random_bytes(8)); mkdir($dir,0700);
$fake=new DatabaseProvisioner(null,static fn(array $request):array=>throw new RuntimeException('Unit must not provision'));
$workflow=new ImportWorkflow(Config::fromEnvironment(),$dir,$fake,static fn(int $id):bool=>true);
$store=new ImportWorkflowStore($dir); $upload=tempnam(sys_get_temp_dir(),'govern-unit-source-');
try {
    file_put_contents($upload,'CREATE TABLE contacts (name TEXT);');
    $source=$workflow->upload(['name'=>'contacts.sql','tmp_name'=>$upload],'backup',[],1);
    check($source['bytes']===34,'Upload byte count');
    check(!isset($source['path'],$source['import_password']),'No private paths or credentials');
    check($source['expires_at']<=time()+86400,'Unsubmitted retention bounded');
    check((fileperms($dir.'/'.$source['source_id'].'.source')&0077)===0,'Source permissions private');
    file_put_contents($upload,"value\n".str_repeat('x',65536)."\n");
    $dataset=$workflow->upload(['name'=>'data.csv','tmp_name'=>$upload],'dataset',[],1);
    check($dataset['datasets'][0]['preview_truncated'],'Large display cell is explicitly shortened');
    check(strlen($dataset['datasets'][0]['rows'][0][0])<40000,'Display preview has a bounded cell');
    $stored=$store->one('SELECT body FROM sources WHERE id=?',[$dataset['source_id']]);
    $metadata=ImportWorkflowStore::decode($stored['body']);
    check(!isset($metadata['datasets'][0]['rows']),'Row samples never persist in control metadata');
    check(!str_contains($stored['body'],str_repeat('x',100)),'No source value copy remains in SQLite metadata');
    rejects(fn()=>$workflow->upload(['name'=>'hidden.zip','tmp_name'=>$upload],'dataset',[],1),'workflow_upload');
    file_put_contents($upload,'CREATE TABLE contacts (name TEXT);');
    rejects(fn()=>$workflow->plan(['kind'=>'empty','engine'=>'sqlite','name'=>'test'],1),'workflow_invalid');
    rejects(fn()=>$workflow->plan(['kind'=>'empty','engine'=>'mariadb','name'=>'mysql'],1),'database_create_invalid');
    rejects(fn()=>$workflow->plan(['kind'=>'empty','engine'=>'postgres','name'=>'pg_private'],1),'database_create_invalid');
    rejects(fn()=>$workflow->plan(['kind'=>'empty','engine'=>'mariadb','name'=>'a'.str_repeat('_',40)],1),'database_create_invalid');
    rejects(fn()=>$workflow->targets(['source_id'=>$source['source_id'],'scope_key'=>'not-selected']),'workflow_invalid');
    check(!$workflow->capabilities()['worker_available'],'API does not invent worker heartbeat');
    $pid=bin2hex(random_bytes(16));
    $plan=['kind'=>'empty','engine'=>'mariadb','name'=>'unit_never_created','schema'=>'','scope_key'=>'unit_never_created','target_mode'=>'new_database','tables'=>[],'source_id'=>null,'source_sha256'=>null];
    $store->execute('INSERT INTO plans(id,body,expires_at,created_at) VALUES(?,?,?,?)',[$pid,ImportWorkflowStore::encode($plan),time()+900,time()]);
    rejects(fn()=>$workflow->submit(['plan_id'=>$pid,'submission_key'=>'unit_operation_key_01'],1),'workflow_worker_unavailable');
    $store->heartbeat();
    $first=$workflow->submit(['plan_id'=>$pid,'submission_key'=>'unit_operation_key_01'],1)['job'];
    $again=$workflow->submit(['plan_id'=>$pid,'submission_key'=>'unit_operation_key_01'],1)['job'];
    check($first['id']===$again['id'],'Replay returns same accepted job');
    check($workflow->submit(['plan_id'=>$pid,'submission_key'=>'unit_operation_key_02'],1)['job']['id']===$first['id'],'Plan authorizes at most one job');
    rejects(fn()=>$workflow->submit(['plan_id'=>bin2hex(random_bytes(16)),'submission_key'=>'unit_operation_key_01'],1),'workflow_plan_changed');
    $store->execute("UPDATE settings SET value='0' WHERE name='worker_seen'");
    check($workflow->stop(['id'=>$first['id']])['job']['state']==='cancelled','Queued stop has no database effects');
    check(!$workflow->capabilities()['worker_available'],'Stop API does not refresh worker heartbeat');
    $stale=$first; $stale['state']=$stale['stage']='importing'; $store->record($stale,'stale_progress');
    check($workflow->job($first['id'])['job']['stop_requested']===true,'Concurrent stop survives stale progress write');
    $workflow->recoverInterrupted();
    check($workflow->job($first['id'])['job']['state']==='unknown','Interrupted attempt becomes Unknown');
    check($workflow->job($first['id'])['job']['action_required'],'Unknown retained for inspection');
    $fixture=$workflow->job($first['id'])['job']; $fixture['created_database']=true;
    $store->record($fixture,'fixture_creation_evidence');
    $decorated=$workflow->decorateDatabases([['name'=>'unit_never_created','engine'=>'mariadb'],['name'=>'other','engine'=>'postgres']]);
    check($decorated[0]['action_required']===true&&$decorated[0]['import_job_id']===$first['id'],'Failure marker uses authorized matching identity');
    check(!isset($decorated[1]['action_required']),'Failure marker cannot leak to another engine/database');
    $fixture['created_database']=false;
    $store->record($fixture,'uncertain_creation_fixture');
    check($workflow->decorateDatabases([['name'=>'unit_never_created','engine'=>'mariadb']])[0]['action_required'],'Uncertain new target still marked when authorized catalog contains it');
    $orphan=bin2hex(random_bytes(16)); file_put_contents($dir.'/'.$orphan.'.source','orphan'); touch($dir.'/'.$orphan.'.source',time()-700);
    $store->execute('UPDATE sources SET expires_at=0 WHERE id=?',[$source['source_id']]);
    $workflow->upload(['name'=>'second.sql','tmp_name'=>$upload],'backup',[],1);
    check(!file_exists($dir.'/'.$source['source_id'].'.source'),'Expired source is removed without touching database');
    check(!file_exists($dir.'/'.$orphan.'.source'),'Unindexed crash orphan removed after grace');
    echo 'Import workflow unit checks passed: '.$checks."\n";
} finally {
    unlink($upload);
    foreach(glob($dir.'/*') as $path) unlink($path);
    rmdir($dir);
}
