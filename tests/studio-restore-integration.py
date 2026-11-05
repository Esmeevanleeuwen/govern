#!/usr/bin/env python3
"""Native PG18 dump/restore in one newly created, random Studio test schema only.

Requires an isolated PHP/PostgreSQL stack with mounted current /repo sources.
No credentials are read or printed; the containers use their configured roles.
"""
from pathlib import Path
import argparse
import base64
import json
import re
import secrets
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--confirm-database', required=True, choices=['govern_studio_test', 'govern_pg'])
parser.add_argument('--postgres-container', default='govern-studio-test-postgres')
parser.add_argument('--app-container', default='govern-studio-test-app')
args = parser.parse_args()
database = args.confirm_database
schema = 'studio_restore_test_' + secrets.token_hex(6)
assert re.fullmatch(r'studio_restore_test_[a-f0-9]{12}', schema)


def run(command, data=None):
    result = subprocess.run(command, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError(result.stderr.decode('utf-8', 'replace') + result.stdout.decode('utf-8', 'replace'))
    return result.stdout


def sql(text):
    return run(['docker', 'exec', '-i', args.postgres_container, 'psql', '-X', '-q', '-A', '-t',
                '--username', 'postgres', '--dbname', database, '--set', 'ON_ERROR_STOP=1'], text.encode())


def migrate():
    migration = Path(__file__).resolve().parents[1] / 'docker/postgres/studio/001-foundation.sql'
    run(['docker', 'exec', '-i', '-e', 'PG_SCHEMAS=' + schema, args.postgres_container,
         'psql', '-X', '-q', '--username', 'postgres', '--dbname', database, '--set', 'ON_ERROR_STOP=1',
         '--set', 'studio_schema=' + schema], migration.read_bytes())


def php(body, state=None):
    encoded = base64.b64encode(json.dumps(state or {}).encode()).decode()
    source = '''<?php
declare(strict_types=1);
require '/var/www/src/bootstrap.php';
use Govern\\Config;
use Govern\\ConnectionScope;
use Govern\\Database;
use Govern\\StudioService;
use Govern\\ApiException;
$base=Config::fromEnvironment();
$config=(new ConnectionScope($base))->select(getenv('PG_DATABASE'),'postgres',getenv('STUDIO_SCHEMA'));
$studio=new StudioService(new Database($config),$config);
$state=json_decode(base64_decode(''' + "'" + encoded + "'" + '''),true,32,JSON_THROW_ON_ERROR);
$uuid=StudioService::newUuid(...);
''' + body
    output = run(['docker', 'exec', '-i', '-u', 'www-data', '-e', 'STUDIO_ENABLED=1',
                  '-e', 'STUDIO_SCHEMA=' + schema, '-e', 'PG_SCHEMAS=' + schema, args.app_container, 'php'], source.encode())
    return json.loads(output)


prepare = '''
$g=$studio->generation();
$board=$studio->createBoard(['id'=>$uuid(),'title'=>'Native restore test','operation_id'=>$uuid(),'generation'=>$g]);
$note=['id'=>$uuid(),'kind'=>'note','text'=>'Preserved source fixture','x'=>0,'y'=>0,'width'=>280,'height'=>200,'data'=>[]];
$studio->mutate(['board_id'=>$board['id'],'base_revision'=>0,'operation_id'=>$uuid(),'generation'=>$g,
 'changes'=>[['type'=>'put-node','node'=>$note]]]);
$recording=$studio->startRecording(['id'=>$uuid(),'board_id'=>$board['id'],'operation_id'=>$uuid(),'generation'=>$g]);
echo json_encode(['generation'=>$g,'board'=>$board,'note'=>$note,'recording'=>$recording],JSON_THROW_ON_ERROR);
'''

verify = '''
$checks=0;
$assert=static function(bool $ok,string $message)use(&$checks):void{if(!$ok)throw new RuntimeException($message);$checks++;};
$new=$studio->generation();
$assert($new!==$state['generation'],'Physical table identity must change after native restore.');
$snapshot=$studio->board($state['board']['id']);
$assert(count($snapshot['nodes'])===1&&$snapshot['nodes'][0]['text']===$state['note']['text'],'Native archive preserves board content.');
$old=$state['generation'];$board=$state['board']['id'];$recording=$state['recording']['id'];
$audio=['board_id'=>$board,'recording_id'=>$recording,'sequence'=>0,'start_ms'=>0,'end_ms'=>6000,
 'operation_id'=>$uuid(),'generation'=>$old,'sha256'=>hash('sha256','native restore fixture')];
$actions=[
 static fn()=>$studio->createBoard(['id'=>$uuid(),'title'=>'stale create','operation_id'=>$uuid(),'generation'=>$old]),
 static fn()=>$studio->mutate(['board_id'=>$board,'base_revision'=>$snapshot['board']['revision'],'operation_id'=>$uuid(),'generation'=>$old,
  'changes'=>[['type'=>'put-node','node'=>[...$state['note'],'text'=>'stale edit']]]]),
 static fn()=>$studio->startRecording(['id'=>$uuid(),'board_id'=>$board,'operation_id'=>$uuid(),'generation'=>$old]),
 static fn()=>$studio->stopRecording(['id'=>$recording,'board_id'=>$board,'generation'=>$old]),
 static fn()=>$studio->prepareAudio($audio),
 static fn()=>$studio->appendTranscript([...$audio,'text'=>'stale provider result','provider'=>'restore-fixture']),
];
foreach($actions as $action){$rejected=false;try{$action();}catch(ApiException $e){$rejected=$e->status===409&&$e->errorCode==='studio_generation_conflict';}
 $assert($rejected,'Every stale write must fail closed after restoration.');}
$result=$studio->mutate(['board_id'=>$board,'base_revision'=>$snapshot['board']['revision'],'operation_id'=>$uuid(),'generation'=>$new,
 'changes'=>[['type'=>'put-node','node'=>[...$state['note'],'text'=>'New generation edit']]]]);
$assert($result['revision']===$snapshot['board']['revision']+1,'A refreshed client can write again.');
$created=$studio->createBoard(['id'=>$uuid(),'title'=>'New generation board','operation_id'=>$uuid(),'generation'=>$new]);
$assert($created['revision']===0,'New generation permits board creation.');
$started=$studio->startRecording(['id'=>$uuid(),'board_id'=>$board,'operation_id'=>$uuid(),'generation'=>$new]);
$assert($started['status']==='recording','New generation permits capture.');
$assert($studio->prepareAudio([...$audio,'generation'=>$new])===null,'New generation permits validated audio.');
$speech=$studio->appendTranscript([...$audio,'generation'=>$new,'text'=>'Nieuw bewaard na herstel.','provider'=>'restore-fixture']);
$assert(!$speech['duplicate']&&$speech['segment']['node_id']!==null,'New generation permits final speech notes.');
$stopped=$studio->stopRecording(['id'=>$recording,'board_id'=>$board,'generation'=>$new]);
$assert($stopped['status']==='stopped','New generation permits capture stop.');
echo json_encode(['checks'=>$checks],JSON_THROW_ON_ERROR);
'''

try:
    assert sql('SELECT current_database();').decode().strip() == database
    assert sql("SELECT count(*) FROM pg_namespace WHERE nspname='" + schema + "';").decode().strip() == '0'
    migrate()
    state = php(prepare)
    migrate()
    repeated = php("echo json_encode(['generation'=>$studio->generation(),'snapshot'=>$studio->board($state['board']['id'])],JSON_THROW_ON_ERROR);", state)
    assert repeated['generation'] == state['generation'], 'Repeating migration must preserve generation'
    assert repeated['snapshot']['nodes'][0]['text'] == state['note']['text'], 'Repeating migration must preserve data'
    archive = run(['docker', 'exec', args.postgres_container, 'pg_dump', '--username', 'postgres',
                   '--dbname', database, '--format', 'custom', '--schema', schema, '--no-owner'])
    assert len(archive) > 100
    # Only our freshly generated, exact random test schema is ever dropped.
    sql('DROP SCHEMA "' + schema + '" CASCADE;')
    run(['docker', 'exec', '-i', args.postgres_container, 'pg_restore', '--username', 'postgres',
         '--dbname', database, '--single-transaction', '--no-owner', '--exit-on-error'], archive)
    result = php(verify, state)
    print('Studio native restore: ' + str(result['checks'] + 3) + ' checks passed; repeat migration preserves content, stale writes rejected.')
finally:
    # This cleanup cannot touch the existing brainstorm/public workspaces.
    sql('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE;')
