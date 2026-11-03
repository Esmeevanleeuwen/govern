<?php
declare(strict_types=1);

/** Fixed graph fixtures in two explicitly confirmed, disposable MariaDB databases. */
require_once dirname(__DIR__) . '/app/src/bootstrap.php';
use Govern\Config;
use Govern\Database;
$options = getopt('', ['confirm-database:', 'confirm-second-database:', 'cleanup']);
$config = Config::fromEnvironment();
$second = getenv('GOVERN_TEST_SECOND_DATABASE') ?: '';
if ($config['name'] !== 'bestuursatlas' || ($options['confirm-database'] ?? '') !== 'bestuursatlas'
    || $second !== 'govern_multi_test' || ($options['confirm-second-database'] ?? '') !== $second) {
    fwrite(STDERR, "Confirm only disposable bestuursatlas and govern_multi_test databases.\n"); exit(2);
}
$pdo = (new Database($config))->writer();
$tables = ['zz_record_map_float_child', 'zz_record_map_float_parent', 'zz_record_map_tasks', 'zz_record_map_projects', 'zz_record_map_people', 'zz_record_map_no_identity',
    'zz_record_map_binary_key', 'zz_record_map_odd`table', '_govern_zz_record_map_probe'];
if (isset($options['cleanup'])) {
    $pdo->exec('DROP VIEW IF EXISTS `zz_record_map_people_view`');
    foreach ($tables as $table) $pdo->exec('DROP TABLE IF EXISTS ' . Database::identifier($table));
    $pdo->exec('DROP TABLE IF EXISTS `govern_multi_test`.`zz_record_map_external_target`');
    echo "Record-map MariaDB fixtures removed.\n"; exit;
}
$pdo->exec('CREATE TABLE `govern_multi_test`.`zz_record_map_external_target` (id INT PRIMARY KEY, name VARCHAR(100) NOT NULL)');
$pdo->exec("INSERT INTO `govern_multi_test`.`zz_record_map_external_target` VALUES (1, 'External record')");
$pdo->exec('CREATE TABLE `zz_record_map_people` (
    id BIGINT NOT NULL PRIMARY KEY, name VARCHAR(200) NOT NULL, manager_id BIGINT NULL,
    external_id INT NULL, amount DECIMAL(30,2) NOT NULL DEFAULT 0, notes TEXT NULL, payload VARBINARY(8) NULL,
    CONSTRAINT zz_record_map_people_manager FOREIGN KEY (manager_id) REFERENCES zz_record_map_people(id),
    CONSTRAINT zz_record_map_people_external FOREIGN KEY (external_id) REFERENCES govern_multi_test.zz_record_map_external_target(id)
)');
$insert = $pdo->prepare('INSERT INTO zz_record_map_people(id,name,manager_id,external_id,amount,notes,payload) VALUES (?,?,?,?,?,?,UNHEX(?))');
$insert->execute(['0', 'Zero', null, null, '0', null, null]);
$insert->execute(['9007199254740993', 'Atlas%_', null, '1', '123456789012345678901234.12', '<img src=x onerror="window.mapInjected=1">', '00ff41']);
$insert->execute(['9007199254740994', 'Beta', '9007199254740993', null, '2.00', '', null]);
$insert->execute(['9007199254740995', 'Gamma', null, null, '3.00', null, null]);
$pdo->exec("UPDATE zz_record_map_people SET manager_id=id WHERE id=9007199254740993");
$pdo->exec('CREATE TABLE zz_record_map_projects (
    tenant_id INT NOT NULL, id INT NOT NULL, name VARCHAR(100) NOT NULL, lead_id BIGINT NULL,
    PRIMARY KEY (tenant_id,id), UNIQUE KEY zz_record_map_project_order (id,tenant_id),
    CONSTRAINT zz_record_map_project_lead FOREIGN KEY (lead_id) REFERENCES zz_record_map_people(id)
)');
$pdo->exec("INSERT INTO zz_record_map_projects VALUES (7,11,'Project Alpha',9007199254740993),
    (7,12,'Project Beta',9007199254740993),(8,11,'Other tenant',9007199254740994)");
$pdo->exec('CREATE TABLE zz_record_map_tasks (
    id INT NOT NULL PRIMARY KEY, name VARCHAR(100) NOT NULL, project_id INT NULL, tenant_id INT NOT NULL,
    CONSTRAINT zz_record_map_task_project FOREIGN KEY (project_id,tenant_id) REFERENCES zz_record_map_projects(id,tenant_id)
)');
$pdo->exec("INSERT INTO zz_record_map_tasks VALUES (1,'Task one',11,7),(2,'Task two',11,7),(3,'Task three',11,7),(4,'No project',NULL,7)");
$pdo->exec('CREATE TABLE zz_record_map_float_parent (id DOUBLE PRIMARY KEY, name VARCHAR(100))');
$pdo->exec('CREATE TABLE zz_record_map_float_child (id INT PRIMARY KEY, parent_id DOUBLE NOT NULL,
    CONSTRAINT zz_record_map_float_link FOREIGN KEY(parent_id) REFERENCES zz_record_map_float_parent(id))');
$pdo->exec("INSERT INTO zz_record_map_float_parent VALUES (1.2345678901234567,'First float'),(1.2345678901234569,'Second float')");
$pdo->exec('INSERT INTO zz_record_map_float_child VALUES (1,1.2345678901234567),(2,1.2345678901234569)');
$pdo->exec('CREATE TABLE zz_record_map_no_identity (name VARCHAR(100))');
$pdo->exec("INSERT INTO zz_record_map_no_identity VALUES ('Unkeyed row'),('Unkeyed row')");
$pdo->exec('CREATE TABLE zz_record_map_binary_key (id VARBINARY(4) PRIMARY KEY, name VARCHAR(100))');
$pdo->exec("INSERT INTO zz_record_map_binary_key VALUES (UNHEX('00ff'),'Binary identity')");
$pdo->exec('CREATE TABLE `zz_record_map_odd``table` (`odd``id` INT PRIMARY KEY, name VARCHAR(100))');
$pdo->exec("INSERT INTO `zz_record_map_odd``table` VALUES (1,'Quoted identifier')");
$pdo->exec('CREATE TABLE _govern_zz_record_map_probe (id INT PRIMARY KEY)');
$pdo->exec('CREATE VIEW zz_record_map_people_view AS SELECT id,name FROM zz_record_map_people');
echo "Record-map MariaDB fixtures prepared.\n";
