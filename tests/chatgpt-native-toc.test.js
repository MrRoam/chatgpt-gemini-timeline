const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

function loadAdapter({ document, window }) {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'js', 'timeline', 'adapters', 'chatgpt.js'),
        'utf8'
    );
    const context = {
        document,
        window,
        SiteAdapter: class {},
        matchesPlatform: () => true,
        ContainerFinder: { findConversationContainer: () => null },
        console,
    };
    vm.createContext(context);
    vm.runInContext(`${source}\nthis.ChatGPTAdapter = ChatGPTAdapter;`, context);
    return new context.ChatGPTAdapter();
}

function makeElement({ parent = null, position = 'static', rect = null } = {}) {
    return {
        parentElement: parent,
        _position: position,
        _rect: rect || { left: 0, width: 0, height: 0 },
        getBoundingClientRect() {
            return this._rect;
        },
    };
}

test('ChatGPT timeline stays at the default inset when the native prompt directory is absent', () => {
    const body = makeElement();
    const document = {
        body,
        querySelector: () => null,
    };
    const window = {
        innerWidth: 1039,
        getComputedStyle: (element) => ({
            position: element._position,
            display: 'block',
            visibility: 'visible',
        }),
    };
    const adapter = loadAdapter({ document, window });

    assert.equal(adapter.getTimelinePosition().right, '16px');
});

test('ChatGPT timeline moves left of the native prompt directory using its measured footprint', () => {
    const body = makeElement();
    const fixedContainer = makeElement({
        parent: body,
        position: 'fixed',
        rect: { left: 987.45, width: 36, height: 290 },
    });
    const list = makeElement({ parent: fixedContainer });
    const button = makeElement({ parent: list });
    const document = {
        body,
        querySelector: (selector) =>
            selector === 'button[data-toc-item-index]' ? button : null,
    };
    const window = {
        innerWidth: 1039,
        getComputedStyle: (element) => ({
            position: element._position,
            display: 'block',
            visibility: 'visible',
        }),
    };
    const adapter = loadAdapter({ document, window });

    assert.equal(adapter.findNativeTimelineContainer(), fixedContainer);
    assert.equal(adapter.getTimelinePosition().right, '60px');
    assert.ok(adapter.getTimelineVisibilitySelectors().includes('button[data-toc-item-index]'));
});
