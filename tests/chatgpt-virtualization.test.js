const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadChatGPTAdapter(document) {
    const baseSource = fs.readFileSync(
        path.join(__dirname, '..', 'js', 'timeline', 'adapters', 'base.js'),
        'utf8'
    );
    const adapterSource = fs.readFileSync(
        path.join(__dirname, '..', 'js', 'timeline', 'adapters', 'chatgpt.js'),
        'utf8'
    );
    const context = {
        document,
        location: { pathname: '/c/12345678-1234-1234-1234-123456789abc' },
        CustomEvent: class {
            constructor(type, init = {}) {
                this.type = type;
                this.detail = init.detail;
            }
        },
        matchesPlatform: () => true,
        ContainerFinder: { findConversationContainer: () => null },
        console,
    };
    vm.createContext(context);
    vm.runInContext(
        `${baseSource}\n${adapterSource}\nthis.ChatGPTAdapter = ChatGPTAdapter;`,
        context
    );
    return new context.ChatGPTAdapter();
}

function makeTurn(id, { role = null, text = '' } = {}) {
    const attributes = new Map([
        ['data-turn-id-container', id],
        ['data-is-intersecting', 'false'],
    ]);
    return {
        childElementCount: role || text ? 1 : 0,
        getAttribute(name) {
            return attributes.get(name) ?? null;
        },
        setAttribute(name, value) {
            attributes.set(name, String(value));
        },
        hasAttribute(name) {
            return attributes.has(name);
        },
        removeAttribute(name) {
            attributes.delete(name);
        },
        querySelector(selector) {
            if (selector === '[data-turn]' && role) {
                return { getAttribute: name => name === 'data-turn' ? role : null };
            }
            if (selector === '.whitespace-pre-wrap' && text) {
                return { textContent: text };
            }
            return null;
        },
    };
}

test('ChatGPT virtualized shells produce every user turn before scrolling', () => {
    const turns = [
        makeTurn('u1'),
        makeTurn('a1'),
        makeTurn('u2'),
        makeTurn('a2'),
        makeTurn('u3', { role: 'user', text: '第三个问题' }),
        makeTurn('a3', { role: 'assistant' }),
    ];
    const document = {
        querySelectorAll(selector) {
            if (selector === '[data-turn-id-container][data-is-intersecting]') return turns;
            if (selector === '[data-turn-id-container][data-ait-turn="user"]') {
                return turns.filter(turn => turn.getAttribute('data-ait-turn') === 'user');
            }
            return [];
        },
        querySelector(selector) {
            return this.querySelectorAll(selector)[0] || null;
        },
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {},
    };
    const adapter = loadChatGPTAdapter(document);

    assert.equal(adapter.prepareTimelineNodes({ force: true }), true);
    assert.equal(
        adapter.getUserMessageSelector(),
        '[data-turn-id-container][data-ait-turn="user"]'
    );
    const userTurns = document.querySelectorAll(adapter.getUserMessageSelector());
    assert.deepEqual(
        userTurns.map(turn => turn.getAttribute('data-turn-id-container')),
        ['u1', 'u2', 'u3']
    );
    assert.equal(adapter.extractText(turns[0]), '[未加载的提问]');
    assert.equal(adapter.extractText(turns[4]), '第三个问题');
});

class EventDocument {
    constructor() {
        this.listeners = new Map();
    }

    addEventListener(type, handler, options = {}) {
        const listeners = this.listeners.get(type) || [];
        listeners.push({ handler, once: options.once === true });
        this.listeners.set(type, listeners);
    }

    removeEventListener(type, handler) {
        const listeners = this.listeners.get(type) || [];
        this.listeners.set(type, listeners.filter(item => item.handler !== handler));
    }

    dispatchEvent(event) {
        const listeners = [...(this.listeners.get(event.type) || [])];
        listeners.forEach(item => {
            item.handler(event);
            if (item.once) this.removeEventListener(event.type, item.handler);
        });
        return true;
    }
}

test('ChatGPT API capture exposes all user texts from the active conversation branch', async () => {
    const source = fs.readFileSync(
        path.join(__dirname, '..', 'js', 'apiCapture', 'chatgpt.js'),
        'utf8'
    );
    const conversationId = '12345678-1234-1234-1234-123456789abc';
    const mapping = {
        u1: {
            id: 'u1',
            parent: null,
            children: ['a1'],
            message: {
                author: { role: 'user' },
                recipient: 'all',
                content: { content_type: 'text', parts: ['第一个问题'] },
            },
        },
        a1: {
            id: 'a1',
            parent: 'u1',
            children: ['u2'],
            message: {
                author: { role: 'assistant' },
                recipient: 'all',
                content: { content_type: 'text', parts: ['回答'] },
            },
        },
        u2: {
            id: 'u2',
            parent: 'a1',
            children: [],
            message: {
                author: { role: 'user' },
                recipient: 'all',
                content: { content_type: 'multimodal_text', parts: ['第二个', '问题'] },
            },
        },
    };
    const document = new EventDocument();
    const response = {
        ok: true,
        clone: () => ({ json: async () => ({ mapping, current_node: 'u2' }) }),
    };
    const window = { fetch: async () => response };
    const context = {
        window,
        document,
        CustomEvent: class {
            constructor(type, init = {}) {
                this.type = type;
                this.detail = init.detail;
            }
        },
        Map,
        Object,
        String,
    };
    vm.createContext(context);
    vm.runInContext(source, context);

    await window.fetch(`https://chatgpt.com/backend-api/conversation/${conversationId}`);
    await new Promise(resolve => setImmediate(resolve));

    let payload = null;
    document.addEventListener('ait-gpt-user-texts-result', event => {
        payload = JSON.parse(event.detail);
    });
    document.dispatchEvent(new context.CustomEvent('ait-gpt-user-texts-pull', {
        detail: conversationId,
    }));

    assert.equal(payload.conversationId, conversationId);
    assert.deepEqual(payload.texts, {
        u1: '第一个问题',
        u2: '第二个 问题',
    });
});
