<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/src/bootstrap.php';
$governUser = \Govern\Web::user('account');
$escape = static fn (string $text): string => htmlspecialchars($text, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex">
    <title>Govern — your account</title>
    <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
    <link rel="stylesheet" href="/assets/styles.css">
    <link rel="stylesheet" href="/assets/auth.css">
    <script type="module" src="/assets/account.js"></script>
</head>
<body class="account-body" data-account-page="account">
    <a class="skip-link" href="#account-main" data-account-text="skip">Skip to content</a>
    <header class="account-header"><a class="brand account-brand" href="/"><span class="brand-mark" aria-hidden="true"></span><strong>govern</strong></a><label class="account-language"><span data-account-text="language">Language</span><select id="account-language"><option value="en">EN</option><option value="nl">NL</option></select></label></header>
    <main class="account-dashboard" id="account-main">
        <div class="account-dashboard-heading"><div><p class="account-eyebrow" data-account-text="yourAccount">Your account</p><h1><?= $escape($governUser['name']) ?></h1><p class="account-description"><?= $escape($governUser['email']) ?></p></div><a href="/workspace.php" class="button button-primary" data-account-text="openWorkspace">Open workspace →</a></div>
        <div id="account-status" class="account-notice" role="status" aria-live="polite" hidden></div>
        <section class="account-card account-membership"><h2 data-account-text="localAccount">Your local account</h2><p data-account-text="accountBoundary">Accounts on this installation share the same permitted work databases. They do not create separate private databases.</p><p><span class="badge" id="account-role"><?= $escape($governUser['role']) ?></span></p><button type="button" class="button button-secondary" id="account-logout" data-account-text="logout">Log out</button></section>
        <?php if ($governUser['role'] === 'owner'): ?>
        <section class="account-card account-requests" aria-labelledby="requests-title"><div class="account-section-heading"><div><p class="account-eyebrow" data-account-text="owner">Workspace owner</p><h2 id="requests-title" data-account-text="requests">Access requests</h2></div><button type="button" class="button button-secondary" id="reload-requests" data-account-text="refresh">Refresh</button></div><p class="account-description" data-account-text="approvalWarning">Approve only people you trust to view and change every database available to this workspace.</p><div id="account-requests" aria-live="polite"></div></section>
        <?php endif; ?>
        <a class="account-back" href="/" data-account-text="back">← Back to Govern</a>
        <noscript><p>JavaScript is required for account actions. Schakel JavaScript in voor accounthandelingen.</p></noscript>
    </main>
</body>
</html>
