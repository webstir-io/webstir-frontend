/**
 * Minimal PJAX-style navigation: swaps the <main> content, updates title/URL,
 * and restores scroll/focus.
 *
 * Opt out per-link with:
 * - data-no-client-nav
 * - data-client-nav="off"
 */
export function enableClientNav() {
    document.addEventListener('click', async (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }
        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
            return;
        }

        const link = target.closest('a');
        if (!link || !(link instanceof HTMLAnchorElement)) {
            return;
        }

        const setting = link.getAttribute('data-client-nav');
        const optOut = link.hasAttribute('data-no-client-nav')
            || setting === 'off'
            || setting === 'false';
        if (optOut) {
            return;
        }

        const isExternal = link.origin !== window.location.origin;
        const opensInNewTab = link.getAttribute('target') === '_blank';
        const isDownload = link.hasAttribute('download');
        if (isExternal || opensInNewTab || isDownload) {
            return;
        }

        const isSameDocumentAnchor = link.hash
            && link.pathname === window.location.pathname
            && link.search === window.location.search;
        if (isSameDocumentAnchor) {
            return;
        }

        event.preventDefault();
        await renderUrl(link.href, { pushHistory: true });
    });

    window.addEventListener('popstate', async () => {
        await renderUrl(window.location.href, { pushHistory: false });
    });
}

let activeRequestId = 0;
let activeController = null;

async function renderUrl(url, { pushHistory }) {
    activeRequestId += 1;
    const requestId = activeRequestId;

    if (activeController) {
        activeController.abort();
    }

    const controller = new AbortController();
    activeController = controller;

    let response;
    try {
        response = await fetch(url, {
            headers: { 'X-Webstir-Client-Nav': '1' },
            signal: controller.signal
        });
    } catch {
        if (controller.signal.aborted) {
            return;
        }

        window.location.href = url;
        return;
    }

    if (!response.ok) {
        window.location.href = url;
        return;
    }

    const html = await response.text();
    if (requestId !== activeRequestId) {
        return;
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const newMain = doc.querySelector('main');
    const currentMain = document.querySelector('main');
    if (newMain && currentMain) {
        currentMain.replaceWith(newMain);
    }

    const newTitle = doc.querySelector('title');
    if (newTitle && newTitle.textContent) {
        document.title = newTitle.textContent;
    }

    if (pushHistory) {
        window.history.pushState({}, '', url);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const focusTarget = document.querySelector('[autofocus]');
    if (focusTarget instanceof HTMLElement) {
        focusTarget.focus();
    }

    window.dispatchEvent(new CustomEvent('webstir:client-nav', { detail: { url } }));
}

enableClientNav();
