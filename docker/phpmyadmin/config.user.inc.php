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

// Keep the exact browser authority. Public hosting is an explicit, single-domain
// opt-in; the gateway supplies HTTPS only on its private TLS-edge listener.
$governAuthority = $_SERVER['HTTP_HOST'] ?? 'localhost:8080';
$governParts = is_string($governAuthority) && !preg_match('/[\x00-\x20\x7f]/', $governAuthority)
    ? parse_url('http://' . $governAuthority) : false;
$governHost = is_array($governParts) ? strtolower((string) ($governParts['host'] ?? '')) : '';
$governPort = is_array($governParts) ? ($governParts['port'] ?? null) : null;
$governCanonical = $governHost . ($governPort !== null ? ':' . $governPort : '');
$governProtocol = $_SERVER['HTTP_X_FORWARDED_PROTO'] ?? 'http';
$governDomain = strtolower(trim(getenv('GOVERN_DOMAIN') ?: ''));
$governDomainValid = preg_match('/\A(?=.{1,253}\z)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?\z/D', $governDomain) === 1;
$governAuthorityValid = is_array($governParts) && $governHost !== ''
    && !array_intersect(['user', 'pass', 'path', 'query', 'fragment'], array_keys($governParts))
    && ($governPort === null || ($governPort >= 1 && $governPort <= 65535))
    && strtolower($governAuthority) === $governCanonical
    && in_array($governProtocol, ['http', 'https'], true);
$governLocal = in_array($governHost, ['localhost', '127.0.0.1', '[::1]'], true);
$governPublic = $governDomainValid && $governHost === $governDomain && $governProtocol === 'https';
if (!$governAuthorityValid || (!$governLocal && !$governPublic)) {
    http_response_code(400);
    exit('Open Govern via the configured address. Open Govern via het ingestelde adres.');
}
$cfg['PmaAbsoluteUri'] = $governProtocol . '://' . $governCanonical . '/phpmyadmin/';

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
// Native MariaDB grants determine the available databases, including manually
// enabled schemas. Keep shared phpMyAdmin settings in the original database.
$cfg['Servers'][1]['hide_db'] = '^(information_schema|mysql|performance_schema|sys)$';
$cfg['Servers'][1]['verbose'] = 'Govern · databases';
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
unset($governAuthority, $governParts, $governHost, $governPort, $governCanonical,
    $governProtocol, $governDomain, $governDomainValid, $governAuthorityValid,
    $governLocal, $governPublic, $governDatabase, $governStorage, $setting, $suffix);
