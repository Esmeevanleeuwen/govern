import {createCompanionSource} from './companion-channel.js';
import {el, icon, button, errorText, toast} from './ui.js';
import {t} from './i18n.js';
import './companion-launch-messages.js';

/** One workspace tab owns one companion; record metadata never goes into storage. */
export function createWorkspaceCompanion({onSelect} = {}) {
    const trigger = document.getElementById('open-companion');
    const feedback = document.getElementById('companion-launch-notice');
    let currentStatus = 'idle';
    const source = createCompanionSource({
        onStatus: status => { currentStatus = status; translate(); },
        onSelect: context => Promise.resolve(onSelect?.(context)).catch(error => toast(errorText(error), 'error')),
    });
    trigger.prepend(icon('monitor'));
    trigger.addEventListener('click', () => source.open('compare'));
    function translate() {
        trigger.dataset.companionStatus = currentStatus;
        trigger.title = t('app.companionLaunch.' + (currentStatus === 'connecting' ? 'connecting' : currentStatus === 'connected' ? 'connected' : 'open'));
        trigger.setAttribute('aria-label', t('app.companionLaunch.open'));
        trigger.querySelector('span').textContent = t('app.companionLaunch.open');
        feedback.hidden = !['blocked', 'unsupported'].includes(currentStatus);
        if (!feedback.hidden) {
            feedback.replaceChildren(el('span', {}, t('app.companionLaunch.' + currentStatus)));
            if (currentStatus === 'blocked') feedback.append(button(t('app.companionLaunch.retry'), () => source.open('compare'), {className: 'button-small'}));
        }
    }
    window.addEventListener('govern:languagechange', translate);
    translate();
    return source;
}
