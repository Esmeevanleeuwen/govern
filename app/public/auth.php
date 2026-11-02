<?php
declare(strict_types=1);
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');
header('X-Frame-Options: SAMEORIGIN');
header("Content-Security-Policy: frame-ancestors 'self'; base-uri 'self'; form-action 'self'");
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="Make Govern your workspace. Create a local account or sign in to your installation.">
    <meta name="robots" content="noindex">
    <title>Govern — your workspace starts here</title>
    <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
    <link rel="stylesheet" href="/assets/styles.css">
    <link rel="stylesheet" href="/assets/auth.css">
    <script type="module" src="/assets/account.js"></script>
</head>
<body class="account-body" data-account-page="auth">
    <a class="skip-link" href="#account-main" data-account-text="skip">Skip to content</a>
    <header class="account-header">
        <a class="brand account-brand" href="/"><span class="brand-mark" aria-hidden="true"></span><strong>govern</strong></a>
        <label class="account-language"><span data-account-text="language">Language</span><select id="account-language"><option value="en">EN</option><option value="nl">NL</option></select></label>
    </header>
    <main class="account-layout" id="account-main">
        <section class="account-story" aria-labelledby="account-story-title">
            <p class="account-eyebrow" data-account-text="eyebrow">A new space for curious developers</p>
            <h1 id="account-story-title"><span data-account-text="heroOne">Your data.</span><br><span class="account-accent" data-account-text="heroTwo">Your next idea.</span></h1>
            <p class="account-intro" data-account-text="intro">A little more clarity. A lot more possibility. Make room for what you want to build next.</p>
            <div class="account-sculpture" aria-hidden="true"><span></span></div>
            <p class="account-local"><span class="account-local-dot" aria-hidden="true"></span><span data-account-text="local">Your account belongs to this Govern installation.</span></p>
        </section>
        <section class="account-card" aria-labelledby="account-title">
            <div class="account-tabs" role="tablist" aria-label="Account">
                <button type="button" id="tab-login" role="tab" aria-controls="account-panel" aria-selected="true" data-mode="login" data-account-text="login">Log in</button>
                <button type="button" id="tab-register" role="tab" aria-controls="account-panel" aria-selected="false" tabindex="-1" data-mode="register" data-account-text="register">Create account</button>
            </div>
            <div id="account-panel" role="tabpanel" aria-labelledby="tab-login">
                <p class="account-eyebrow" id="account-kicker" data-account-text="welcomeBack">Welcome back</p>
                <h2 id="account-title" data-account-text="loginTitle">Pick up where you left off.</h2>
                <p class="account-description" id="account-description" data-account-text="loginDescription">Sign in to open your local workspace.</p>
                <div id="account-status" class="account-notice" role="status" aria-live="polite" data-account-text="checking">Checking your installation…</div>
                <form id="account-form" class="account-form" aria-describedby="account-description">
                    <div id="account-name-field" hidden><label class="field-label" for="account-name" data-account-text="name">Your name</label><input class="input" id="account-name" name="name" autocomplete="name" maxlength="100" disabled></div>
                    <div><label class="field-label" for="account-email" data-account-text="email">Email address</label><input class="input" type="email" id="account-email" name="email" autocomplete="email" maxlength="254" required disabled></div>
                    <div><label class="field-label" for="account-password" data-account-text="password">Password</label><div class="account-password-wrap"><input class="input" type="password" id="account-password" name="password" autocomplete="current-password" maxlength="128" required disabled><button class="account-password-toggle" type="button" id="toggle-password" aria-controls="account-password" aria-pressed="false" data-account-text="show">Show</button></div><p class="field-hint" id="password-hint" hidden data-account-text="passwordHint">Use 12–128 characters. A longer, unique passphrase works well.</p></div>
                    <div id="confirm-field" hidden><label class="field-label" for="account-confirm" data-account-text="confirm">Confirm password</label><input class="input" type="password" id="account-confirm" autocomplete="new-password" maxlength="128" disabled></div>
                    <button class="button button-primary account-submit" id="account-submit" type="submit" disabled data-account-text="login">Log in</button>
                </form>
                <button class="button button-secondary" id="account-retry" type="button" hidden data-account-text="retry">Try again</button>
                <a class="account-back" href="/" data-account-text="back">← Back to Govern</a>
            </div>
            <noscript><p>JavaScript is required to sign in. Schakel JavaScript in om in te loggen.</p></noscript>
        </section>
    </main>
    <footer class="account-footer"><span data-account-text="footer">A clearer view. A new starting point.</span><a href="https://github.com/Esmeevanleeuwen/govern/blob/main/README.md" data-account-text="setup">Setup guide ↗</a></footer>
</body>
</html>
