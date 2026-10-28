<?php
declare(strict_types=1);

// This file is loaded by the official image after its environment configuration.
$cfg['AllowThirdPartyFraming'] = 'sameorigin';
$cfg['SendErrorReports'] = 'never';
$cfg['VersionCheck'] = false;
$cfg['AllowUserDropDatabase'] = true;
$cfg['MaxRows'] = 25;
$cfg['ServerDefault'] = 1;
// Govern already provides a table selector. The native tree stays available
// through its expand arrow, without covering the editor on a narrow screen.
$cfg['NavigationWidth'] = 0;

// Preserve the browser's loopback hostname and port behind the local proxy.
$governHost = $_SERVER['HTTP_HOST'] ?? 'localhost:8080';
if (!preg_match('/\A(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?\z/i', $governHost)) {
    http_response_code(400);
    exit('Open Govern via localhost of 127.0.0.1.');
}
$cfg['PmaAbsoluteUri'] = 'http://' . $governHost . '/phpmyadmin/';

$governDatabase = getenv('DB_NAME') ?: 'bestuursatlas';
$cfg['Servers'][1]['host'] = getenv('PMA_HOST') ?: 'database';
$cfg['Servers'][1]['port'] = getenv('PMA_PORT') ?: '3306';
if (getenv('PMA_SOCKET')) {
    $cfg['Servers'][1]['socket'] = getenv('PMA_SOCKET');
    $cfg['Servers'][1]['connect_type'] = 'socket';
}
$cfg['Servers'][1]['auth_type'] = 'config';
$cfg['Servers'][1]['user'] = getenv('PMA_USER') ?: 'govern';
$cfg['Servers'][1]['password'] = getenv('PMA_PASSWORD') ?: '';
$cfg['Servers'][1]['AllowNoPassword'] = false;
$cfg['Servers'][1]['only_db'] = [$governDatabase];
$cfg['Servers'][1]['verbose'] = 'Govern · werkdatabase';
$cfg['Servers'][1]['pmadb'] = $governDatabase;
$cfg['Servers'][1]['controluser'] = $cfg['Servers'][1]['user'];
$cfg['Servers'][1]['controlpass'] = $cfg['Servers'][1]['password'];

$governStorage = [
    'bookmarktable' => 'bookmark', 'relation' => 'relation',
    'table_info' => 'table_info', 'table_coords' => 'table_coords',
    'pdf_pages' => 'pdf_pages', 'column_info' => 'column_info',
    'history' => 'history', 'recent' => 'recent', 'favorite' => 'favorite',
    'table_uiprefs' => 'table_uiprefs', 'tracking' => 'tracking',
    'userconfig' => 'userconfig', 'users' => 'users', 'usergroups' => 'usergroups',
    'navigationhiding' => 'navigationhiding', 'savedsearches' => 'savedsearches',
    'central_columns' => 'central_columns', 'designer_settings' => 'designer_settings',
    'export_templates' => 'export_templates',
];
foreach ($governStorage as $setting => $suffix) {
    $cfg['Servers'][1][$setting] = '_govern_pma__' . $suffix;
}
unset($governHost, $governDatabase, $governStorage, $setting, $suffix);
