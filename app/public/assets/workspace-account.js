import './account-messages.js';
import {t} from './i18n.js';

const label = document.querySelector('#workspace-account-label');
function translateAccount() { if (label) label.textContent = t('account.account'); }
translateAccount();
window.addEventListener('govern:languagechange', translateAccount);
window.addEventListener('govern:authrequired', () => {
    if (document.querySelector('#session-ended-dialog')) return;
    const dialog = document.createElement('dialog');
    dialog.id = 'session-ended-dialog'; dialog.className = 'account-approve-dialog';
    const title = document.createElement('h2'); title.id = 'session-ended-title'; title.textContent = t('account.expired');
    dialog.setAttribute('aria-labelledby', title.id);
    const description = document.createElement('p'); description.textContent = t('account.sessionDetail');
    const actions = document.createElement('div'); actions.className = 'account-dialog-actions';
    const link = document.createElement('a'); link.className = 'button button-primary'; link.href = '/auth.php?mode=login'; link.target = '_blank'; link.rel = 'noopener'; link.textContent = t('account.signInAgain');
    const close = document.createElement('button'); close.type = 'button'; close.className = 'button button-secondary'; close.textContent = t('account.cancel'); close.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => dialog.remove(), {once: true});
    actions.append(close, link); dialog.append(title, description, actions); document.body.append(dialog); dialog.showModal(); link.focus();
});
