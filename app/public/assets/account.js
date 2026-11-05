import './account-messages.js';
import {t, setLanguage, getLanguage} from './i18n.js';
import {getPreferences, updatePreferences} from './preferences.js';
import {accountRequest} from './session.js';
import {attachDialog} from './modal-shell.js';

const page = document.body.dataset.accountPage;
const form = document.querySelector('#account-form');
const status = document.querySelector('#account-status');
const language = document.querySelector('#account-language');
let mode = new URLSearchParams(location.search).get('mode') === 'register' ? 'register' : 'login';
let state = null;
let busy = false;
let pending = false;
let notice = null;
let requests = [];
let requestsLoading = false;

function showNotice(value, kind = 'info', translated = true) {
    notice = value ? {value, kind, translated} : null;
    renderNotice();
}

function showError(error) {
    notice = {value: error.message, kind: 'error', translated: false, translations: error.translations};
    renderNotice();
}

function renderNotice() {
    status.hidden = !notice;
    if (!notice) return;
    status.textContent = notice.translations?.[getLanguage()] || (notice.translated ? t('account.' + notice.value) : notice.value);
    status.dataset.kind = notice.kind;
    status.setAttribute('role', notice.kind === 'error' ? 'alert' : 'status');
}

function translate() {
    for (const element of document.querySelectorAll('[data-account-text]')) element.textContent = t('account.' + element.dataset.accountText);
    language.value = getLanguage();
    if (page === 'auth') renderMode();
    if (page === 'account') {
        document.querySelector('#account-role').textContent = t('account.' + (state?.user?.role || 'member'));
        renderRequests();
    }
    renderNotice();
}

function setBusy(value) {
    busy = value;
    if (form) {
        const ready = Boolean(state) && !state.user && !pending;
        for (const field of form.querySelectorAll('input,button')) field.disabled = value || !ready;
        if (ready && mode === 'login') document.querySelector('#account-name').disabled = document.querySelector('#account-confirm').disabled = true;
        for (const tab of document.querySelectorAll('[data-mode]')) tab.disabled = value;
        document.querySelector('#account-submit').textContent = t('account.' + (value ? 'busy' : mode === 'login' ? 'login' : 'register'));
        form.setAttribute('aria-busy', String(value));
    }
}

function renderMode() {
    const registering = mode === 'register';
    document.querySelector('#account-name-field').hidden = !registering;
    document.querySelector('#confirm-field').hidden = !registering;
    document.querySelector('#password-hint').hidden = !registering;
    document.querySelector('#account-name').required = registering;
    document.querySelector('#account-confirm').required = registering;
    const password = document.querySelector('#account-password');
    password.autocomplete = registering ? 'new-password' : 'current-password';
    password.minLength = registering ? 12 : 1;
    for (const tab of document.querySelectorAll('[data-mode]')) {
        tab.setAttribute('aria-selected', String(tab.dataset.mode === mode));
        tab.tabIndex = tab.dataset.mode === mode ? 0 : -1;
    }
    document.querySelector('#account-panel').setAttribute('aria-labelledby', 'tab-' + mode);
    document.querySelector('#account-kicker').textContent = t('account.' + (registering ? 'registerKicker' : 'welcomeBack'));
    document.querySelector('#account-title').textContent = t('account.' + (pending ? 'pendingTitle' : state?.user ? 'signedIn' : registering ? 'registerTitle' : 'loginTitle'));
    document.querySelector('#account-description').textContent = t('account.' + (state?.user ? 'signedInDescription' : registering ? 'registerDescription' : 'loginDescription'));
    document.querySelector('#toggle-password').textContent = t('account.' + (password.type === 'password' ? 'show' : 'hide'));
    form.hidden = pending || Boolean(state?.user);
    let continueLink = document.querySelector('#account-continue');
    if (state?.user && !continueLink) {
        continueLink = document.createElement('a');
        continueLink.id = 'account-continue';
        continueLink.className = 'button button-primary account-submit';
        continueLink.href = destination();
        form.after(continueLink);
    }
    if (continueLink) { continueLink.hidden = !state?.user; continueLink.textContent = t('account.openWorkspace'); }
    setBusy(busy);
}

async function load() {
    showNotice('checking');
    const retry = document.querySelector('#account-retry');
    if (retry) retry.hidden = true;
    setBusy(true);
    try {
        state = await accountRequest('status');
        if (page === 'account' && !state.user) { location.replace('/auth.php?mode=login&next=account'); return; }
        pending = false;
        showNotice(page === 'auth' && mode === 'register' && !state.user ? state.has_owner ? 'needsApproval' : 'firstOwner' : null);
        if (page === 'account' && state.user?.role === 'owner') await loadRequests();
    } catch (error) {
        showError(error);
        if (retry) retry.hidden = false;
    } finally { setBusy(false); translate(); }
}

function destination() {
    if (new URLSearchParams(location.search).get('next') === 'account') return '/account.php';
    if (new URLSearchParams(location.search).get('next') === 'studio') {
        const board = new URLSearchParams(location.search).get('board');
        return '/studio.php' + (board && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(board)
            ? '?board=' + encodeURIComponent(board) : '');
    }
    const legacyHash = /^#(?:overzicht|gegevens|structuur|schema|onderzoeken|experimenten|instellingen)(?:\?|$)/.test(location.hash) ? location.hash : '';
    return '/workspace.php' + legacyHash;
}

if (form) {
    document.querySelectorAll('[data-mode]').forEach(tab => {
        tab.addEventListener('click', () => {
            if (busy) return;
            mode = tab.dataset.mode;
            pending = false;
            document.querySelector('#account-confirm').setCustomValidity('');
            const url = new URL(location.href);
            url.searchParams.set('mode', mode);
            history.replaceState(null, '', url);
            showNotice(mode === 'register' && state && !state.user ? state.has_owner ? 'needsApproval' : 'firstOwner' : null);
            renderMode();
        });
        tab.addEventListener('keydown', event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const targetMode = event.key === 'Home' ? 'login' : event.key === 'End' ? 'register' : mode === 'login' ? 'register' : 'login';
            const target = document.querySelector('#tab-' + targetMode);
            target.click(); target.focus();
        });
    });
    document.querySelector('#toggle-password').addEventListener('click', event => {
        const input = document.querySelector('#account-password');
        input.type = input.type === 'password' ? 'text' : 'password';
        event.currentTarget.setAttribute('aria-pressed', String(input.type === 'text'));
        event.currentTarget.textContent = t('account.' + (input.type === 'text' ? 'hide' : 'show'));
    });
    document.querySelector('#account-confirm').addEventListener('input', event => event.target.setCustomValidity(''));
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (busy || !state) return;
        const data = new FormData(form);
        if (mode === 'register' && data.get('password') !== data.get('confirm')) {
            // Confirmation is UI-only; it never leaves this page.
            const confirmation = document.querySelector('#account-confirm');
            confirmation.setCustomValidity(t('account.mismatch'));
            confirmation.reportValidity();
            return;
        }
        setBusy(true); showNotice(null);
        try {
            const result = await accountRequest(mode, {email: data.get('email'), password: data.get('password'), ...(mode === 'register' ? {name: data.get('name')} : {})});
            form.reset();
            if (result.user) { location.assign(destination()); return; }
            pending = true;
            state.has_owner = true;
            showNotice('pending', 'success');
        } catch (error) {
            showError(error);
        } finally { setBusy(false); renderMode(); }
    });
    // FormData needs the confirmation's name for client-only comparison.
    document.querySelector('#account-confirm').name = 'confirm';
    document.querySelector('#account-retry').addEventListener('click', load);
}

function renderRequests() {
    const container = document.querySelector('#account-requests');
    if (!container) return;
    container.replaceChildren();
    if (requestsLoading || requests.length === 0) {
        const message = document.createElement('p');
        message.className = 'account-empty';
        message.textContent = t('account.' + (requestsLoading ? 'loadingRequests' : 'noRequests'));
        container.append(message);
    }
    for (const user of requests) {
        const row = document.createElement('div'); row.className = 'account-request';
        const details = document.createElement('div');
        const name = document.createElement('strong'); name.textContent = user.name;
        const email = document.createElement('span'); email.textContent = user.email;
        details.append(name, email);
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'button button-primary'; button.textContent = t('account.approve');
        button.addEventListener('click', () => approveDialog(user, button));
        row.append(details, button); container.append(row);
    }
}

async function loadRequests() {
    requestsLoading = true; renderRequests();
    const refresh = document.querySelector('#reload-requests');
    if (refresh) refresh.disabled = true;
    try { requests = (await accountRequest('requests')).users; }
    catch (error) { showError(error); }
    finally { requestsLoading = false; renderRequests(); if (refresh) refresh.disabled = false; }
}

function approveDialog(user, opener) {
    const dialog = document.createElement('dialog'); dialog.className = 'account-approve-dialog';
    const heading = document.createElement('h2'); heading.id = 'approval-title'; heading.textContent = t('account.approveTitle');
    dialog.setAttribute('aria-labelledby', heading.id);
    const text = document.createElement('p'); text.textContent = t('account.approveBody', user);
    const actions = document.createElement('div'); actions.className = 'account-dialog-actions';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'button button-secondary'; cancel.textContent = t('account.cancel');
    const approve = document.createElement('button'); approve.type = 'button'; approve.className = 'button button-primary'; approve.textContent = t('account.approve');
    cancel.addEventListener('click', () => dialog.close());
    approve.addEventListener('click', async () => {
        cancel.disabled = approve.disabled = true;
        try { await accountRequest('approve', {user_id: user.id}); dialog.close(); showNotice('approved', 'success'); await loadRequests(); }
        catch (error) { dialog.close(); showError(error); }
    });
    actions.append(cancel, approve); dialog.append(heading, text, actions); document.body.append(dialog);
    const shell = attachDialog(dialog, {handle: heading});
    dialog.addEventListener('cancel', event => { if (approve.disabled) event.preventDefault(); });
    dialog.addEventListener('close', () => { shell.destroy(); dialog.remove(); if (opener.isConnected) opener.focus(); }, {once: true});
    dialog.showModal(); cancel.focus();
}

document.querySelector('#reload-requests')?.addEventListener('click', loadRequests);
document.querySelector('#account-logout')?.addEventListener('click', async event => {
    const button = event.currentTarget; button.disabled = true;
    try { await accountRequest('logout', {}); location.assign('/'); }
    catch (error) { showError(error); button.disabled = false; }
});
language.addEventListener('change', () => {
    updatePreferences({language: language.value});
    setLanguage(language.value); translate();
});
setLanguage(getPreferences().language);
window.addEventListener('govern:languagechange', translate);
translate();
load();
