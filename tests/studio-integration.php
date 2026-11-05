<?php
declare(strict_types=1);

/** Real isolated PostgreSQL: board -> objects -> speech sources -> read-only Govern views. */
require_once dirname(__DIR__) . '/app/src/bootstrap.php';
use Govern\ApiException;
use Govern\Catalog;
use Govern\Config;
use Govern\ConnectionScope;
use Govern\Database;
use Govern\StudioService;

$base = Config::fromEnvironment();
$options = getopt('', ['confirm-database:']);
$name = $base['postgres']['name'] ?? '';
if (!in_array($name, ['govern_studio_test', 'govern_pg'], true) || ($options['confirm-database'] ?? '') !== $name) {
    fwrite(STDERR, "Use an isolated govern_studio_test/govern_pg database and --confirm-database.\n"); exit(2);
}
$config = (new ConnectionScope($base))->select($name, 'postgres', $base['studio']['schema'] ?? 'brainstorm');
$database = new Database($config);
$service = new StudioService($database, $config);
$other = new StudioService(new Database($config), $config);
$passed = 0;
$assert = static function (bool $condition, string $message) use (&$passed): void {
    if (!$condition) throw new RuntimeException($message); $passed++;
};
$reject = static function (callable $action, int $status, string $code) use ($assert): void {
    try { $action(); } catch (ApiException $e) {
        $assert($e->status === $status && $e->errorCode === $code, $code . ': got ' . $e->status . ' ' . $e->errorCode); return;
    }
    throw new RuntimeException('Expected rejection: ' . $code);
};
$uuid = StudioService::newUuid(...);
$created = [];
$schema = $database->quoteIdentifier($database->schemaName());
$table = static fn (string $suffix): string => $schema . '."_govern_studio_' . $suffix . '"';
$node = static fn (string $id, string $text, string $kind = 'note', array $data = []): array =>
    ['id'=>$id,'kind'=>$kind,'text'=>$text,'x'=>50,'y'=>75,'width'=>280,'height'=>200,'data'=>$data];
try {
    $assert($service->ready(), 'Versioned schema is ready.');
    $generation = $service->generation();
    $assert(strlen($generation) === 64 && $generation === $other->generation(), 'Clients share the physical generation.');
    $reject(static fn () => new StudioService($database, [...$config, 'studio'=>['enabled'=>false,'schema'=>'brainstorm']]), 403, 'studio_disabled');
    $reject(static fn () => new StudioService($database, [...$config, 'studio'=>['enabled'=>true,'schema'=>'public']]), 503, 'studio_config_invalid');
    $firstInput = ['id'=>$uuid(),'title'=>'Studio integration α <text>','operation_id'=>$uuid(),'generation'=>$generation];
    $created[] = $firstInput['id'];
    $first = $service->createBoard($firstInput);
    $assert($first['title'] === $firstInput['title'] && $first['revision'] === 0, 'Exact UTF-8 title is stored.');
    $assert($service->createBoard($firstInput) === $first, 'Create replay returns original response.');
    $reject(static fn () => $service->createBoard([...$firstInput,'title'=>'changed replay']), 409, 'studio_operation_conflict');
    $reject(static fn () => $service->createBoard([...$firstInput,'generation'=>str_repeat('0',64)]), 409, 'studio_generation_conflict');
    $created[] = $secondId = $uuid();
    $second = $service->createBoard(['id'=>$secondId,'title'=>'Other board','operation_id'=>$uuid(),'generation'=>$generation]);
    $assert(count(array_filter($service->boards(), static fn ($b) => in_array($b['id'],$created,true))) === 2, 'Boards are centrally visible.');
    $one=$uuid(); $two=$uuid(); $stroke=$uuid(); $screen=$uuid(); $edge=$uuid();
    $mutation = ['board_id'=>$first['id'],'base_revision'=>0,'operation_id'=>$uuid(),'generation'=>$generation,'changes'=>[
        ['type'=>'put-node','node'=>$node($one,'Manual note')],
        ['type'=>'put-node','node'=>$node($two,'<script>literal</script>','idea',['color'=>'#AABBCC'])],
        ['type'=>'put-node','node'=>$node($stroke,'','stroke',['points'=>[[0,0],[20,40],[120,70]],'size'=>3,'color'=>'#0b7476'])],
        ['type'=>'put-node','node'=>$node($screen,'Book a session','screen',['layout'=>'form'])],
        ['type'=>'put-edge','edge'=>['id'=>$edge,'from_node_id'=>$one,'to_node_id'=>$two,'label'=>'supports']],
    ]];
    $saved=$service->mutate($mutation);
    $assert($saved['revision'] === 1, 'Object batch has one revision.');
    $assert($other->mutate($mutation) === $saved, 'Independent client resolves uncertain operation outcome.');
    $snapshot=$other->board($first['id']); $nodes=array_column($snapshot['nodes'],null,'id');
    $assert(count($snapshot['nodes'])===4 && count($snapshot['edges'])===1, 'Notes, stroke, screen and edge reload.');
    $assert($nodes[$two]['text']==='<script>literal</script>' && $nodes[$two]['data']->color==='#aabbcc', 'Literal text and normalized data round trip.');
    $assert($nodes[$stroke]['data']->points===[[0,0],[20,40],[120,70]], 'Editable vector points round trip.');
    $reject(static fn ()=>$other->mutate([...$mutation,'operation_id'=>$uuid()]),409,'studio_revision_conflict');
    $reject(static fn ()=>$service->mutate([...$mutation,'changes'=>[['type'=>'delete-node','id'=>$one]]]),409,'studio_operation_conflict');
    $mutate=static fn (string $board,array $changes):array=>$service->mutate(['board_id'=>$board,
        'base_revision'=>$service->board($board)['board']['revision'],'operation_id'=>$uuid(),'generation'=>$generation,'changes'=>$changes]);
    $foreign=$uuid(); $mutate($second['id'],[['type'=>'put-node','node'=>$node($foreign,'Other board only')]]);
    $badEdge=['type'=>'put-edge','edge'=>['id'=>$uuid(),'from_node_id'=>$one,'to_node_id'=>$foreign,'label'=>'cross-board']];
    $reject(static fn ()=>$mutate($first['id'],[$badEdge]),422,'studio_node_missing');
    $foreignKeyDenied=false;
    try {
        $q=$database->writer()->prepare('INSERT INTO '.$table('edges').' (board_id,id,from_node_id,to_node_id) VALUES (:board,:id,:first,:second)');
        $q->execute(['board'=>$first['id'],'id'=>$uuid(),'first'=>$one,'second'=>$foreign]);
    } catch (PDOException $e) { $foreignKeyDenied=$e->getCode()==='23503'; }
    $assert($foreignKeyDenied,'PostgreSQL foreign keys enforce board identity independently of PHP.');
    $before=$service->board($first['id']);
    $reject(static fn ()=>$mutate($first['id'],[['type'=>'put-node','node'=>$node($one,'rollback')],$badEdge]),422,'studio_node_missing');
    $assert($service->board($first['id'])==$before, 'Failed edge rolls back preceding changes.');
    $reject(static fn ()=>$mutate($first['id'],[['type'=>'put-node','node'=>[...$node($one,'forged'),'source_segment_id'=>$uuid()]]]),422,'studio_input_invalid');
    $reject(static fn ()=>$mutate($first['id'],[['type'=>'put-node','node'=>[...$node($one,'bad geometry'),'x'=>INF]]]),422,'studio_input_invalid');
    $reject(static fn ()=>$mutate($first['id'],[['type'=>'put-node','node'=>$node($one,'','stroke',['points'=>[[0,0]],'size'=>3])]]),422,'studio_input_invalid');
    $reject(static fn ()=>$mutate($first['id'],array_fill(0,101,['type'=>'delete-node','id'=>$one])),422,'studio_input_invalid');
    $recording=['id'=>$uuid(),'board_id'=>$first['id'],'operation_id'=>$uuid(),'generation'=>$generation];
    $started=$service->startRecording($recording);
    $assert($started['status']==='recording' && $service->startRecording($recording)==$started,'Recording start is idempotent.');
    $audio=['board_id'=>$first['id'],'recording_id'=>$recording['id'],'operation_id'=>$uuid(),'generation'=>$generation,
        'sequence'=>0,'start_ms'=>0,'end_ms'=>6000,'sha256'=>hash('sha256','isolated fixture')];
    $assert($service->prepareAudio($audio)===null,'First chunk may reach provider.');
    $reject(static fn ()=>$service->prepareAudio([...$audio,'sequence'=>1]),409,'studio_segment_conflict');
    $source=[...$audio,'text'=>'Een agenda voor coaches.','provider'=>'isolated-provider-fixture'];
    $speech=$service->appendTranscript($source);
    $assert(!$speech['duplicate'] && $speech['segment']['text']===$source['text'] && $speech['segment']['node_id']!==null,'Final speech creates traceable note.');
    $assert($service->prepareAudio($audio)['duplicate'],'Exact retry is resolved before provider.');
    $reject(static fn ()=>$service->prepareAudio([...$audio,'sequence'=>1,'start_ms'=>6000,'end_ms'=>12000,
        'sha256'=>hash('sha256','fresh audio with reused operation')]),409,'studio_operation_conflict');
    $reject(static fn ()=>$service->prepareAudio([...$audio,'sha256'=>hash('sha256','other')]),409,'studio_segment_conflict');
    $reject(static fn ()=>$service->prepareAudio([...$audio,'operation_id'=>$uuid()]),409,'studio_segment_conflict');
    $speechNode=$speech['segment']['node_id'];
    $mutate($first['id'],[['type'=>'put-node','node'=>$node($speechNode,'Human edited note.')]]);
    $assert($service->findSegment($first['id'],$recording['id'],0)['text']===$source['text'],'Manual edit preserves source transcript.');
    $assert($service->appendTranscript($source)['duplicate'],'Provider replay does not create another card.');
    $edited=array_column($service->board($first['id'])['nodes'],null,'id');
    $assert($edited[$speechNode]['text']==='Human edited note.','Provider replay preserves manual card edit.');
    $silent=[...$audio,'operation_id'=>$uuid(),'sequence'=>1,'start_ms'=>6000,'end_ms'=>12000,'sha256'=>hash('sha256','silence'),'text'=>'','provider'=>'isolated-provider-fixture'];
    $silence=$service->appendTranscript($silent);
    $assert($silence['segment']['node_id']===null,'Silence keeps timeline without empty note.');
    $reject(static fn ()=>$service->appendTranscript([...$silent,'operation_id'=>$uuid(),'sequence'=>2,'start_ms'=>13000,'end_ms'=>18000]),409,'studio_segment_conflict');
    $stop=['id'=>$recording['id'],'board_id'=>$first['id'],'generation'=>$generation];
    $stopped=$service->stopRecording($stop);
    $assert($stopped['status']==='stopped' && $service->stopRecording($stop)===$stopped,'Stop is repeat-safe.');
    $later=[...$silent,'operation_id'=>$uuid(),'sequence'=>2,'start_ms'=>12000,'end_ms'=>18000];
    $reject(static fn ()=>$service->prepareAudio(array_diff_key($later,['text'=>true,'provider'=>true])),409,'studio_recording_stopped');
    $reject(static fn ()=>$service->appendTranscript($later),409,'studio_recording_stopped');
    $reject(static fn ()=>$service->stopRecording([...$stop,'generation'=>str_repeat('0',64)]),409,'studio_generation_conflict');
    $reject(static fn ()=>$service->appendTranscript([...$source,'generation'=>str_repeat('0',64)]),409,'studio_generation_conflict');
    $reject(static fn ()=>$service->prepareAudio([...$audio,'board_id'=>$second['id']]),404,'studio_recording_missing');
    $mutate($first['id'],[['type'=>'delete-node','id'=>$speechNode]]);
    $assert($service->findSegment($first['id'],$recording['id'],0)['node_id']===null,'Deleted card leaves transcript intact.');
    $mutate($first['id'],[['type'=>'put-node','node'=>$node($speechNode,'Undo restored card.')]]);
    $restored=array_column($service->board($first['id'])['nodes'],null,'id');
    $assert($restored[$speechNode]['source_segment_id']===$speech['segment']['id'],'Undo restores source using server-known UUID.');
    $mutate($first['id'],[['type'=>'delete-node','id'=>$one]]);
    $assert($service->board($first['id'])['edges']===[],'Node deletion cascades only attached edges.');
    $visible=array_column((new Catalog($database))->tables(),'name');
    $assert(in_array('studio_boards',$visible,true)&&in_array('studio_notes',$visible,true)&&in_array('studio_transcripts',$visible,true),'Govern sees all public Studio views.');
    $assert(!in_array('_govern_studio_nodes',$visible,true),'Internal tables stay out of Records editor.');
    $q=$database->reader()->prepare('SELECT text FROM '.$schema.'.studio_transcripts WHERE id=:id'); $q->execute(['id'=>$speech['segment']['id']]);
    $assert($q->fetchColumn()===$source['text'],'Reader sees original transcript in Govern.');
    $denied=false; try {$database->reader()->exec('DELETE FROM '.$table('nodes').' WHERE false');} catch(PDOException $e){$denied=in_array($e->getCode(),['25006','42501'],true);}
    $assert($denied,'Database prevents reader mutations.');
    $denied=false; try {$database->writer()->exec('CREATE TABLE '.$schema.'.studio_unexpected_ddl(id integer)');} catch(PDOException $e){$denied=$e->getCode()==='42501';}
    $assert($denied,'Web writer cannot create objects.');
    $denied=false; try {$database->writer()->exec('UPDATE '.$schema.'.studio_notes SET text=\'bypass\' WHERE false');} catch(PDOException $e){$denied=in_array($e->getCode(),['55000','42501'],true);}
    $assert($denied,'Govern views cannot auto-update underlying canvas tables.');
    echo 'Studio integration: '.$passed." checks passed.\n";
} finally {
    if($database->writer()->inTransaction())$database->writer()->rollBack();
    foreach($created as $id){$q=$database->writer()->prepare('DELETE FROM '.$table('boards').' WHERE id=:id');$q->execute(['id'=>$id]);}
}
