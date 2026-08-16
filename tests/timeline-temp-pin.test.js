const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

class FakeClassList {
    constructor(element) {
        this.element = element;
        this.classes = new Set();
    }

    add(...classNames) {
        classNames.forEach(className => this.classes.add(className));
        this._sync();
    }

    remove(...classNames) {
        classNames.forEach(className => this.classes.delete(className));
        this._sync();
    }

    toggle(className, force) {
        const shouldAdd = force === undefined ? !this.classes.has(className) : !!force;
        if (shouldAdd) {
            this.classes.add(className);
        } else {
            this.classes.delete(className);
        }
        this._sync();
        return shouldAdd;
    }

    contains(className) {
        return this.classes.has(className);
    }

    setFromString(value) {
        this.classes = new Set(String(value || '').split(/\s+/).filter(Boolean));
        this._sync(false);
    }

    _sync(updateAttr = true) {
        this.element._className = [...this.classes].join(' ');
        if (updateAttr) {
            this.element.attributes.class = this.element._className;
        }
    }
}

class FakeElement {
    constructor(tagName) {
        this.tagName = tagName.toUpperCase();
        this.nodeType = 1;
        this.children = [];
        this.parentNode = null;
        this.attributes = {};
        this.dataset = {};
        this.eventListeners = {};
        this._className = '';
        this.classList = new FakeClassList(this);
        this.innerHTML = '';
        this.textContent = '';
        if (this.tagName === 'CANVAS') {
            this.getContext = () => ({
                font: '',
                measureText: (text) => ({ width: String(text || '').length * 8 }),
            });
        }
        this.style = {
            values: {},
            setProperty: (name, value) => {
                this.style.values[name] = String(value);
            },
            getPropertyValue: (name) => this.style.values[name] || '',
        };
    }

    get className() {
        return this._className;
    }

    set className(value) {
        this.classList.setFromString(value);
    }

    appendChild(child) {
        if (child.tagName === '#FRAGMENT') {
            [...child.children].forEach(fragmentChild => this.appendChild(fragmentChild));
            child.children = [];
            return child;
        }
        child.parentNode = this;
        this.children.push(child);
        return child;
    }

    insertBefore(child, referenceChild) {
        if (!referenceChild) return this.appendChild(child);
        const index = this.children.indexOf(referenceChild);
        if (index === -1) return this.appendChild(child);
        child.parentNode = this;
        this.children.splice(index, 0, child);
        return child;
    }

    get parentElement() {
        return this.parentNode;
    }

    contains(target) {
        if (target === this) return true;
        return this.children.some(child => child.contains?.(target));
    }

    get isConnected() {
        let node = this;
        while (node) {
            if (node.tagName === 'BODY') return true;
            node = node.parentNode;
        }
        return false;
    }

    remove() {
        if (!this.parentNode) return;
        this.parentNode.children = this.parentNode.children.filter(child => child !== this);
        this.parentNode = null;
    }

    setAttribute(name, value) {
        this.attributes[name] = String(value);
        if (name === 'class') {
            this.className = value;
        } else if (name.startsWith('data-')) {
            const key = name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
            this.dataset[key] = String(value);
        }
    }

    getAttribute(name) {
        return this.attributes[name] ?? null;
    }

    removeAttribute(name) {
        delete this.attributes[name];
    }

    addEventListener(type, handler) {
        if (!this.eventListeners[type]) this.eventListeners[type] = [];
        this.eventListeners[type].push(handler);
    }

    dispatchEvent(event) {
        event.target = event.target || this;
        event.currentTarget = this;
        event.stopPropagation = event.stopPropagation || (() => {});
        event.preventDefault = event.preventDefault || (() => {});
        for (const handler of this.eventListeners[event.type] || []) {
            handler(event);
        }
    }

    querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null;
    }

    matches(selector) {
        const simpleSelectors = selector.split(',').map(part => part.trim()).filter(Boolean);
        return simpleSelectors.some(simpleSelector => {
            if (simpleSelector.startsWith('#')) {
                return this.attributes.id === simpleSelector.slice(1);
            }
            if (simpleSelector.startsWith('.')) {
                return this.classList.contains(simpleSelector.slice(1));
            }
            const tagAttrMatch = simpleSelector.match(/^([a-z0-9-]+)(\[.+\])$/i);
            if (tagAttrMatch) {
                const [, tagName, attrSelector] = tagAttrMatch;
                return this.tagName.toLowerCase() === tagName.toLowerCase() && this._matchesAttributeSelector(attrSelector);
            }
            if (/^\[.+\]$/.test(simpleSelector)) {
                return this._matchesAttributeSelector(simpleSelector);
            }
            return this.tagName.toLowerCase() === simpleSelector.toLowerCase();
        });
    }

    _matchesAttributeSelector(selector) {
        const attrs = [...selector.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)];
        return attrs.length > 0 && attrs.every(([, name, value]) => {
            if (!(name in this.attributes)) return false;
            return value === undefined || this.attributes[name] === value;
        });
    }

    querySelectorAll(selector) {
        const results = [];
        const walk = (element) => {
            for (const child of element.children) {
                if (child.matches(selector)) results.push(child);
                walk(child);
            }
        };
        walk(this);
        return results;
    }
}

class FakeDocument {
    constructor() {
        this.body = new FakeElement('body');
        this.documentElement = new FakeElement('html');
    }

    createElement(tagName) {
        return new FakeElement(tagName);
    }

    createDocumentFragment() {
        return new FakeElement('#fragment');
    }

    querySelector(selector) {
        return this.body.querySelector(selector);
    }

    querySelectorAll(selector) {
        return this.body.querySelectorAll(selector);
    }
}

function loadTimelineManager(options = {}) {
    const document = new FakeDocument();
    const storageCalls = [];
    const sourcePath = path.join(__dirname, '..', 'js', 'timeline', 'timeline-manager.js');
    const source = fs.readFileSync(sourcePath, 'utf8');
    const context = {
        console,
        document,
        window: {
            globalTooltipManager: {
                show: () => {},
                hide: () => {},
                hideOverlay: () => {},
                showOverlay: () => {},
            },
            eventDelegateManager: { on: () => {} },
        },
        navigator: {},
        location: { pathname: '/c/test', href: 'https://chatgpt.com/c/test' },
        chrome: { i18n: { getMessage: () => '' }, storage: { local: { get: async () => ({}) } } },
        requestAnimationFrame: (callback) => callback(0),
        cancelAnimationFrame: () => {},
        setTimeout: options.setTimeout || (() => 0),
        clearTimeout: options.clearTimeout || (() => {}),
        MutationObserver: options.MutationObserver || class {
            constructor() {}
            observe() {}
            disconnect() {}
        },
        ResizeObserver: options.ResizeObserver || class {
            observe() {}
            disconnect() {}
        },
        IntersectionObserver: options.IntersectionObserver || class {
            observe() {}
            disconnect() {}
        },
        Node: { ELEMENT_NODE: 1 },
        getSiteNameMap: () => ({}),
        getCurrentPlatform: () => ({ features: {} }),
        TIMELINE_CONFIG: { DEBOUNCE_DELAY: 0, INITIAL_RENDER_DELAY: 0 },
        StorageAdapter: options.StorageAdapter || {},
        PinStorageManager: {
            findByKey: async (key) => {
                storageCalls.push(['findByKey', key]);
                return undefined;
            },
            add: async (item) => {
                storageCalls.push(['add', item]);
            },
            remove: async (key) => {
                storageCalls.push(['remove', key]);
            },
            getByUrl: async (url) => {
                storageCalls.push(['getByUrl', url]);
                return [];
            },
        },
        TimelineUtils: {
            removeElementSafe: (element) => element?.remove(),
            clearTimerSafe: (timer) => {
                if (timer) clearTimeout(timer);
                return null;
            },
        },
    };
    context.window.window = context.window;
    vm.createContext(context);
    vm.runInContext(`${source}\nthis.TimelineManager = TimelineManager;`, context);
    return { TimelineManager: context.TimelineManager, document, storageCalls };
}

function createManager(options = {}) {
    const { TimelineManager, document, storageCalls } = loadTimelineManager(options);
    const adapter = {
        extractConversationId: () => 'test',
        extractIndexFromTurnId: (id) => id.replace(/^chatgpt-/, ''),
        getUserMessageSelector: () => '[data-turn="user"][data-turn-id]',
        getFeatures: () => ({ notepad: true, questionList: false, timeline_tooltipActions: true }),
        getTimelinePosition: () => ({}),
        getScrollOffset: () => 0,
        shouldHideTimeline: () => false,
        getImageUploadInputSelector: () => 'input[type="file"]',
    };
    const manager = new TimelineManager(adapter);
    manager.applyTimelineActiveColor = () => {};
    manager.cacheTooltipConfig = () => {};
    manager.truncateText = (text) => text;
    manager.getSiteNameFromUrl = () => 'ChatGPT';
    manager.ui.timelineBar = document.createElement('div');
    manager.ui.timelineBar.className = 'ait-chat-timeline-bar';
    manager.ui.track = document.createElement('div');
    manager.ui.track.className = 'ait-timeline-track';
    manager.ui.trackContent = document.createElement('div');
    manager.ui.trackContent.className = 'ait-timeline-track-content';
    manager.ui.track.appendChild(manager.ui.trackContent);
    manager.ui.timelineBar.appendChild(manager.ui.track);
    document.body.appendChild(manager.ui.timelineBar);
    return { manager, document, storageCalls };
}

function makeMarker(document, id) {
    return {
        id,
        summary: `summary ${id}`,
        element: document.createElement('article'),
        dotElement: document.createElement('button'),
        dotN: id.endsWith('1') ? 0.25 : 0.75,
        pinned: false,
    };
}

test('togglePin creates a single temporary marker without writing pin storage', async () => {
    const { manager, document, storageCalls } = createManager();
    const first = makeMarker(document, 'chatgpt-1');
    const second = makeMarker(document, 'chatgpt-2');
    manager.markers = [first, second];
    manager.firstUserTurnOffset = 100;
    manager.contentSpanPx = 1000;
    manager.scrollContainer = { scrollTop: 600 };
    manager.activeTurnId = 'chatgpt-1';

    const result = await manager.toggleCurrentTemporaryPin();

    assert.equal(result, true);
    assert.deepEqual(storageCalls, []);
    assert.deepEqual([...manager.pinned], []);
    assert.equal(first.pinned, false);
    assert.equal(second.pinned, false);

    const pins = manager.ui.timelineBar.querySelectorAll('.timeline-pin-marker');
    assert.equal(pins.length, 1);
    assert.equal(pins[0].tagName, 'BUTTON');
    assert.equal(pins[0].getAttribute('aria-label'), 'Return to pinned answer');
    assert.equal(pins[0].style.getPropertyValue('--timeline-pin-y'), '12px');

    manager.scrollContainer.scrollTop = 840;
    const replaced = await manager.toggleCurrentTemporaryPin();

    assert.equal(replaced, true);
    assert.equal(manager.temporaryPin.scrollTop, 840);
    assert.equal(manager.ui.timelineBar.querySelectorAll('.timeline-pin-marker').length, 1);
    assert.equal(
        manager.ui.timelineBar.querySelector('.timeline-pin-marker').getAttribute('aria-label'),
        'Return to pinned answer'
    );
});

test('clicking a temporary line marker scrolls back to the captured scroll position', async () => {
    const { manager, document } = createManager();
    const first = makeMarker(document, 'chatgpt-1');
    const second = makeMarker(document, 'chatgpt-2');
    manager.markers = [first, second];
    manager.firstUserTurnOffset = 100;
    manager.contentSpanPx = 1000;
    manager.scrollContainer = { scrollTop: 450 };
    manager.activeTurnId = 'chatgpt-1';
    manager.scheduleScrollSync = () => {};
    let scrolledTo = null;
    manager.smoothScrollTo = (element) => {
        scrolledTo = element;
    };

    await manager.toggleCurrentTemporaryPin();
    manager.scrollContainer.scrollTop = 900;
    const pin = manager.ui.timelineBar.querySelector('.timeline-pin-marker');
    pin.dispatchEvent({ type: 'click' });

    assert.equal(scrolledTo, null);
    assert.equal(manager.scrollContainer.scrollTop, 450);
    assert.equal(manager.pinNavigationActive, true);
    assert.equal(manager.ui.timelineBar.classList.contains('ait-pin-location-active'), true);
    assert.equal(pin.getAttribute('aria-current'), 'location');
});

test('timeline toolbar shows a Pin chat button instead of the flash note pencil', () => {
    const { manager, document } = createManager();
    manager.ui.timelineBar.remove();
    manager.ui.timelineBar = null;

    manager.injectTimelineUI();

    const pinButton = document.querySelector('.ait-temp-pin-btn');
    assert.ok(pinButton);
    assert.equal(pinButton.getAttribute('aria-label'), 'Pin chat');
    assert.equal(pinButton.style.display, 'flex');
    assert.match(pinButton.innerHTML, /M12 17v5/);
    assert.equal(document.querySelector('.ait-notepad-btn'), null);
    assert.equal(document.querySelector('.ait-question-list-btn'), null);
});

test('Pin toolbar button stays an action while replacing the saved position', async () => {
    const { manager, document } = createManager();
    manager.ui.timelineBar.remove();
    manager.ui.timelineBar = null;
    manager.injectTimelineUI();
    manager.scrollContainer = { scrollTop: 320 };

    const pinButton = document.querySelector('.ait-temp-pin-btn');
    manager.ui.wrapper = null;
    assert.equal(pinButton.getAttribute('aria-label'), 'Pin chat');
    assert.equal(pinButton.getAttribute('aria-pressed'), null);
    assert.equal(pinButton.classList.contains('active'), false);

    await manager.toggleCurrentTemporaryPin();
    assert.equal(pinButton.getAttribute('aria-label'), 'Pin chat');
    assert.equal(pinButton.getAttribute('aria-pressed'), null);
    assert.equal(pinButton.classList.contains('active'), false);

    manager.scrollContainer.scrollTop = 640;
    await manager.toggleCurrentTemporaryPin();
    assert.equal(manager.temporaryPin.scrollTop, 640);
    assert.equal(pinButton.getAttribute('aria-label'), 'Pin chat');
    assert.equal(pinButton.getAttribute('aria-pressed'), null);
    assert.equal(pinButton.classList.contains('active'), false);
});

test('timeline toolbar keeps the auto-send image upload feature hidden while unavailable', () => {
    const { manager, document } = createManager();
    manager.ui.timelineBar.remove();
    manager.ui.timelineBar = null;

    manager.injectTimelineUI();

    const toggle = document.querySelector('.ait-auto-send-upload-toggle');

    assert.equal(manager.autoSendImageUploadsAvailable, false);
    assert.equal(manager.autoSendImageUploadsEnabled, false);
    assert.equal(toggle, null);
});

test('timeline tooltip preview contains only the question text', () => {
    const { manager, document } = createManager();
    const dot = document.createElement('button');
    const preview = manager._buildNodeTooltipElement(dot, '这是用户的问题');

    assert.equal(preview.children.length, 1);
    assert.equal(preview.children[0].className, 'timeline-tooltip-content');
    assert.equal(preview.children[0].textContent, '这是用户的问题');
    assert.equal(preview.querySelector('.timeline-tooltip-time'), null);
    assert.equal(preview.querySelector('.timeline-tooltip-actions'), null);
});

test('auto-send image upload waits for upload readiness then sends once', () => {
    const timers = [];
    const { manager, document } = createManager({
        setTimeout: (callback, delay) => {
            const timer = { callback, delay, cleared: false };
            timers.push(timer);
            return timer;
        },
        clearTimeout: (timer) => {
            if (timer) timer.cleared = true;
        },
    });
    timers.length = 0;
    let ready = false;
    let sent = 0;
    manager.autoSendImageUploadsAvailable = true;
    manager.autoSendImageUploadsEnabled = true;
    manager.adapter.getImageUploadInputSelector = () => 'input[type="file"]';
    manager.adapter.isImageUploadReadyToSend = () => ready;
    manager.adapter.sendImageUploadMessage = () => {
        sent++;
        return true;
    };

    const input = document.createElement('input');
    input.setAttribute('type', 'file');
    input.files = [{ name: 'photo.png', type: 'image/png' }];

    assert.equal(manager.handleAutoSendImageUploadChange({ target: input }), true);
    assert.equal(sent, 0);
    assert.equal(timers[0].delay, 300);

    timers[0].callback();
    assert.equal(sent, 0);

    ready = true;
    timers[1].callback();
    assert.equal(sent, 1);
    assert.equal(manager._pendingAutoSendImageUpload, null);
});

test('auto-send image upload waits for an attachment preview before sending', () => {
    const timers = [];
    const { manager, document } = createManager({
        setTimeout: (callback, delay) => {
            const timer = { callback, delay, cleared: false };
            timers.push(timer);
            return timer;
        },
        clearTimeout: (timer) => {
            if (timer) timer.cleared = true;
        },
    });
    timers.length = 0;
    let hasAttachment = false;
    let sent = 0;
    manager.autoSendImageUploadsAvailable = true;
    manager.autoSendImageUploadsEnabled = true;
    manager.adapter.getImageUploadInputSelector = () => 'input[type="file"]';
    manager.adapter.isImageUploadReadyToSend = () => true;
    manager.adapter.hasImageUploadAttachment = () => hasAttachment;
    manager.adapter.sendImageUploadMessage = () => {
        sent++;
        return true;
    };

    const input = document.createElement('input');
    input.setAttribute('type', 'file');
    input.files = [{ name: 'photo.png', type: 'image/png' }];

    assert.equal(manager.handleAutoSendImageUploadChange({ target: input }), true);
    timers[0].callback();
    assert.equal(sent, 0);

    hasAttachment = true;
    timers[1].callback();
    assert.equal(sent, 1);
});

test('auto-send image upload sends when upload makes a disabled composer ready even without a detectable preview', () => {
    const timers = [];
    const { manager, document } = createManager({
        setTimeout: (callback, delay) => {
            const timer = { callback, delay, cleared: false };
            timers.push(timer);
            return timer;
        },
        clearTimeout: (timer) => {
            if (timer) timer.cleared = true;
        },
    });
    timers.length = 0;
    let ready = false;
    let sent = 0;
    manager.autoSendImageUploadsAvailable = true;
    manager.autoSendImageUploadsEnabled = true;
    manager.adapter.getImageUploadInputSelector = () => 'input[type="file"]';
    manager.adapter.isImageUploadReadyToSend = () => ready;
    manager.adapter.hasImageUploadAttachment = () => false;
    manager.adapter.sendImageUploadMessage = () => {
        sent++;
        return true;
    };

    const input = document.createElement('input');
    input.setAttribute('type', 'file');
    input.files = [{ name: 'photo.png', type: 'image/png' }];

    assert.equal(manager.handleAutoSendImageUploadChange({ target: input }), true);
    timers[0].callback();
    assert.equal(sent, 0);

    ready = true;
    timers[1].callback();
    assert.equal(sent, 1);
});

test('auto-send image upload handles pasted image files', () => {
    const timers = [];
    const { manager } = createManager({
        setTimeout: (callback, delay) => {
            const timer = { callback, delay, cleared: false };
            timers.push(timer);
            return timer;
        },
        clearTimeout: (timer) => {
            if (timer) timer.cleared = true;
        },
    });
    timers.length = 0;
    let sent = 0;
    manager.autoSendImageUploadsAvailable = true;
    manager.autoSendImageUploadsEnabled = true;
    manager.adapter.isImageUploadReadyToSend = () => true;
    manager.adapter.hasImageUploadAttachment = () => true;
    manager.adapter.sendImageUploadMessage = () => {
        sent++;
        return true;
    };

    const event = {
        clipboardData: {
            files: [{ name: 'pasted.png', type: 'image/png' }],
            items: [],
        },
    };

    assert.equal(manager.handleAutoSendImageUploadCandidateEvent(event), true);
    timers[0].callback();
    assert.equal(sent, 1);
});

test('auto-send image upload ignores non-image files and disabled switch', () => {
    const timers = [];
    const { manager, document } = createManager({
        setTimeout: (callback, delay) => {
            timers.push({ callback, delay });
            return timers.length;
        },
    });
    timers.length = 0;
    manager.adapter.getImageUploadInputSelector = () => 'input[type="file"]';
    manager.autoSendImageUploadsAvailable = true;

    const input = document.createElement('input');
    input.setAttribute('type', 'file');
    input.files = [{ name: 'notes.txt', type: 'text/plain' }];

    manager.autoSendImageUploadsEnabled = true;
    assert.equal(manager.handleAutoSendImageUploadChange({ target: input }), false);
    assert.equal(timers.length, 0);

    input.files = [{ name: 'photo.jpg', type: 'image/jpeg' }];
    manager.autoSendImageUploadsEnabled = false;
    assert.equal(manager.handleAutoSendImageUploadChange({ target: input }), false);
    assert.equal(timers.length, 0);
});

test('timeline stylesheet defines the temporary pin toolbar button', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'js', 'timeline', 'timeline.css'), 'utf8');
    assert.match(css, /\.ait-temp-pin-btn\s*\{/);
    assert.match(css, /\.ait-temp-pin-btn\.active\s*\{/);
});

test('timeline pin gets its own full-gap slot after a pinned question', () => {
    const { manager, document } = createManager();
    const first = makeMarker(document, 'chatgpt-1');
    const second = makeMarker(document, 'chatgpt-2');
    first.offsetTop = 100;
    second.offsetTop = 200;
    manager.markers = [first, second];
    manager.ui.wrapper = document.createElement('div');
    manager.ui.timelineBar.clientHeight = 240;
    manager.getTrackPadding = () => 16;
    manager.getCompactGap = () => 12;
    manager.detectCssVarTopSupport = () => false;
    manager.scrollContainer = { scrollTop: 108 };

    manager.setTemporaryPinAtScrollTop(108, second.id);

    const pin = manager.ui.trackContent.querySelector('.timeline-pin-marker');
    assert.ok(pin);
    assert.deepEqual(Array.from(manager.yPositions), [108, 120]);
    assert.equal(pin.style.getPropertyValue('--timeline-pin-y'), '132px');
    assert.equal(manager.temporaryPin.slotIndex, 2);
    assert.equal(manager.temporaryPin.trackY - manager.yPositions[1], 12);
    assert.equal(manager.ui.timelineBar.querySelector('.timeline-pin-marker'), pin);

    const css = fs.readFileSync(path.join(__dirname, '..', 'js', 'timeline', 'timeline.css'), 'utf8');
    const variables = fs.readFileSync(path.join(__dirname, '..', 'styles', 'variables.css'), 'utf8');
    assert.match(css, /\.timeline-pin-marker\s*\{[\s\S]*?top:\s*var\(--timeline-pin-y, 0px\)/);
    assert.match(css, /\.timeline-pin-marker::before\s*\{[\s\S]*?width:\s*var\(--timeline-pin-line-width\)/);
    assert.doesNotMatch(css, /border-left:\s*9px solid/);
    assert.match(variables, /--timeline-pin-line-width:\s*10px/);
    assert.match(variables, /--timeline-pin-line-color:\s*#F5B700/);
});

test('near-edge pin positions share one discrete slot without crowding either question', () => {
    const { manager, document } = createManager();
    const first = makeMarker(document, 'chatgpt-1');
    const second = makeMarker(document, 'chatgpt-2');
    const third = makeMarker(document, 'chatgpt-3');
    first.offsetTop = 100;
    second.offsetTop = 500;
    third.offsetTop = 1100;
    manager.markers = [first, second, third];
    manager.ui.wrapper = document.createElement('div');
    manager.ui.timelineBar.clientHeight = 400;
    manager.getTrackPadding = () => 16;
    manager.getCompactGap = () => 12;
    manager.detectCssVarTopSupport = () => false;

    assert.equal(manager.getTemporaryPinSlotIndex(101, null), 1);
    assert.equal(manager.getTemporaryPinSlotIndex(499, null), 1);
    assert.equal(manager.getTemporaryPinSlotIndex(500, null), 2);

    manager.setTemporaryPinAtScrollTop(499);

    assert.deepEqual(Array.from(manager.yPositions), [182, 206, 218]);
    assert.equal(manager.temporaryPin.trackY, 194);
    assert.equal(manager.temporaryPin.trackY - manager.yPositions[0], 12);
    assert.equal(manager.yPositions[1] - manager.temporaryPin.trackY, 12);
});

test('pin navigation emphasis clears after scrolling away from the saved location', () => {
    const { manager } = createManager();
    manager.scrollContainer = { scrollTop: 450 };
    manager.setTemporaryPinAtScrollTop(450);
    manager.setPinNavigationActive(true);

    manager.scrollContainer.scrollTop = 460;

    assert.equal(manager.syncPinNavigationState(), false);
    assert.equal(manager.pinNavigationActive, false);
    assert.equal(manager.ui.timelineBar.classList.contains('ait-pin-location-active'), false);
});

test('Pin icon is the first control below the timeline and aligns with resting ticks', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'js', 'timeline', 'timeline.css'), 'utf8');
    assert.match(css, /\.ait-chat-timeline-wrapper\s*\{[\s\S]*?width:\s*32px/);
    assert.doesNotMatch(css, /\.ait-question-list-btn\s*\{/);
    assert.match(css, /\.ait-temp-pin-btn\s*\{[\s\S]*?top:\s*calc\(var\(--timeline-toolbar-y, 100%\) \+ 6px\);[\s\S]*?right:\s*-6px/);
    assert.match(css, /\.timeline-starred-btn\s*\{[\s\S]*?top:\s*calc\(var\(--timeline-toolbar-y, 100%\) \+ 38px\);[\s\S]*?right:\s*-6px/);
});

test('timeline utility icons follow the last visible question line', () => {
    const { manager, document } = createManager();
    manager.ui.wrapper = document.createElement('div');
    manager.ui.timelineBar.clientHeight = 400;
    manager.ui.track.scrollTop = 0;
    manager.yPositions = [182, 194, 206, 218];

    assert.equal(manager.updateTimelineToolbarPosition(), true);
    assert.equal(manager.ui.wrapper.style.getPropertyValue('--timeline-toolbar-y'), '218px');
});

test('selected pin becomes the only emphasized timeline location', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'js', 'timeline', 'timeline.css'), 'utf8');
    assert.match(css, /\.ait-chat-timeline-bar\.ait-pin-location-active[\s\S]*?\.timeline-pin-marker-current:not\(:hover\)::before\s*\{[\s\S]*?width:\s*var\(--timeline-line-width-active\)/);
    assert.match(css, /\.ait-chat-timeline-bar\.ait-pin-location-active[\s\S]*?\.ait-timeline-dot\.active:not\(:hover\):not\(:focus-visible\)::after\s*\{[\s\S]*?background-color:\s*var\(--ait-timeline-dot-color\)/);
});

test('idle lines alternate between long and short widths while the active line stays emphasized', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'js', 'timeline', 'timeline.css'), 'utf8');
    const variables = fs.readFileSync(path.join(__dirname, '..', 'styles', 'variables.css'), 'utf8');
    assert.match(variables, /--timeline-compact-line-width-long:\s*14px/);
    assert.match(variables, /--timeline-compact-line-width-short:\s*10px/);
    assert.match(variables, /--timeline-line-width-active:\s*28px/);
    assert.match(variables, /--timeline-pin-line-width:\s*10px/);
    assert.match(css, /\.ait-timeline-dot\.line-odd::after\s*\{[\s\S]*?width:\s*var\(--timeline-compact-line-width-short\)/);
    assert.match(css, /\.ait-timeline-dot\.active::after\s*\{[\s\S]*?width:\s*var\(--timeline-line-width-active\)/);
    assert.match(css, /\.ait-timeline-dot\.active:hover::after,[\s\S]*?width:\s*var\(--timeline-line-width-hover\)/);
    assert.match(css, /\.timeline-pin-marker:hover::before,[\s\S]*?width:\s*var\(--timeline-line-width-hover\)/);
});

test('hover cascade expands two neighboring slots and includes the yellow Pin slot', () => {
    const { manager, document } = createManager();
    manager.markers = ['1', '2', '3', '4'].map(id => makeMarker(document, `chatgpt-${id}`));
    manager.yPositions = [100, 112, 136, 148];

    manager.markers.forEach(marker => {
        marker.dotElement.className = 'ait-timeline-dot';
        manager.ui.trackContent.appendChild(marker.dotElement);
    });
    manager.temporaryPin = { scrollTop: 450, trackY: 124, sourceMarkerId: null };
    manager.renderPinMarkers();

    const pin = manager.ui.trackContent.querySelector('.timeline-pin-marker-current');
    assert.equal(manager.setTimelineHoverCascade(pin), true);
    assert.equal(manager.markers[1].dotElement.classList.contains('timeline-neighbor-1'), true);
    assert.equal(manager.markers[2].dotElement.classList.contains('timeline-neighbor-1'), true);
    assert.equal(manager.markers[0].dotElement.classList.contains('timeline-neighbor-2'), true);
    assert.equal(manager.markers[3].dotElement.classList.contains('timeline-neighbor-2'), true);

    assert.equal(manager.setTimelineHoverCascade(manager.markers[1].dotElement), true);
    assert.equal(manager.markers[0].dotElement.classList.contains('timeline-neighbor-1'), true);
    assert.equal(pin.classList.contains('timeline-neighbor-1'), true);
    assert.equal(manager.markers[2].dotElement.classList.contains('timeline-neighbor-2'), true);
});

test('hover cascade uses 28, 20, 14 and 10 pixel width steps', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'js', 'timeline', 'timeline.css'), 'utf8');
    const variables = fs.readFileSync(path.join(__dirname, '..', 'styles', 'variables.css'), 'utf8');
    assert.match(variables, /--timeline-line-width-hover:\s*28px/);
    assert.match(variables, /--timeline-line-width-near:\s*20px/);
    assert.match(variables, /--timeline-line-width-far:\s*14px/);
    assert.match(css, /\.ait-timeline-dot\.timeline-neighbor-1[\s\S]*?width:\s*var\(--timeline-line-width-near\)/);
    assert.match(css, /\.ait-timeline-dot\.timeline-neighbor-2[\s\S]*?width:\s*var\(--timeline-line-width-far\)/);
    assert.match(css, /\.timeline-pin-marker\.timeline-neighbor-1[\s\S]*?width:\s*var\(--timeline-line-width-near\)/);
});

test('timeline stylesheet renders every node as a right-anchored expanding line', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'js', 'timeline', 'timeline.css'), 'utf8');
    const variables = fs.readFileSync(path.join(__dirname, '..', 'styles', 'variables.css'), 'utf8');
    assert.match(css, /\.ait-timeline-dot::after\s*\{[\s\S]*?right:\s*2px/);
    assert.match(css, /\.ait-timeline-dot:hover::after,[\s\S]*?width:\s*var\(--timeline-line-width-hover\)/);
    assert.match(css, /\.ait-timeline-dot\.active::after\s*\{[\s\S]*?width:\s*var\(--timeline-line-width-active\)/);
    assert.match(css, /\.ait-chat-timeline-bar\s*\{[\s\S]*?background:\s*transparent/);
    assert.match(css, /height:\s*var\(--timeline-hit-height\)/);
    assert.match(variables, /--timeline-compact-gap:\s*12px/);
    assert.match(variables, /--timeline-hit-height:\s*12px/);
    assert.match(variables, /--timeline-line-width-hover:\s*28px/);
    assert.match(variables, /--timeline-line-width-active:\s*28px/);
    assert.match(variables, /--timeline-line-emphasis-color:\s*#111111/);
    assert.match(variables, /html\[data-timeline-theme="dark"\][\s\S]*--timeline-line-emphasis-color:\s*#F5F5F5/);
    assert.match(css, /\.ait-timeline-dot:hover::after,[\s\S]*?background-color:\s*var\(--timeline-line-emphasis-color\)/);
    assert.match(css, /\.ait-timeline-dot\.active::after\s*\{[\s\S]*?background-color:\s*var\(--timeline-line-emphasis-color\)/);
});

test('ChatGPT timeline keeps a safe fallback inset and detects the native prompt directory', () => {
    const adapter = fs.readFileSync(path.join(__dirname, '..', 'js', 'timeline', 'adapters', 'chatgpt.js'), 'utf8');
    assert.match(adapter, /const defaultRightInset = 16/);
    assert.match(adapter, /button\[data-toc-item-index\]/);
});

test('timeline geometry keeps a small question set clustered at a fixed 12px gap', () => {
    const { manager, document } = createManager();
    manager.ui.timelineBar.clientHeight = 400;
    manager.ui.trackContent = document.createElement('div');
    manager.ui.timelineBar.appendChild(manager.ui.trackContent);
    manager.getTrackPadding = () => 16;
    manager.getCompactGap = () => 12;
    manager.detectCssVarTopSupport = () => false;
    manager.markers = Array.from({ length: 4 }, (_, index) => makeMarker(document, `chatgpt-${index}`));

    manager.updateTimelineGeometry();

    assert.equal(manager.isCompactMode, true);
    assert.deepEqual(Array.from(manager.yPositions), [182, 194, 206, 218]);
    assert.equal(manager.contentHeight, 400);
});

test('timeline geometry preserves the 12px gap in long chats by growing the inner track', () => {
    const { manager, document } = createManager();
    manager.ui.timelineBar.clientHeight = 400;
    manager.ui.trackContent = document.createElement('div');
    manager.ui.timelineBar.appendChild(manager.ui.trackContent);
    manager.getTrackPadding = () => 16;
    manager.getCompactGap = () => 12;
    manager.detectCssVarTopSupport = () => false;
    manager.markers = Array.from({ length: 40 }, (_, index) => makeMarker(document, `chatgpt-${index}`));

    manager.updateTimelineGeometry();

    assert.equal(manager.yPositions[0], 16);
    assert.equal(manager.yPositions[39], 484);
    assert.equal(manager.contentHeight, 500);
    assert.equal(manager.yPositions[1] - manager.yPositions[0], 12);
});

test('timeline stylesheet defines the auto-send image upload switch', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'js', 'timeline', 'timeline.css'), 'utf8');
    assert.match(css, /\.ait-auto-send-upload-toggle\s*\{/);
    assert.match(css, /\.ait-auto-send-upload-toggle\[aria-checked="true"\]/);
});

test('auto bottom jump creates a temporary marker when no previous pin exists', () => {
    const { manager, document } = createManager();
    const first = makeMarker(document, 'chatgpt-1');
    const second = makeMarker(document, 'chatgpt-2');
    const third = makeMarker(document, 'chatgpt-3');
    const fourth = makeMarker(document, 'chatgpt-4');
    manager.markers = [first, second, third];
    manager.firstUserTurnOffset = 100;
    manager.contentSpanPx = 1000;
    manager.scrollContainer = { scrollTop: 450 };
    manager.activeTurnId = 'chatgpt-1';
    manager._lastScrollSnapshot = {
        scrollTop: 450,
        activeIndex: 0,
        totalCount: 3,
        isLast: false,
        timestamp: Date.now(),
    };

    assert.equal(manager._captureAutoBottomJumpCandidate(3, 4), true);

    manager.markers = [first, second, third, fourth];
    manager.scrollContainer.scrollTop = 1200;
    manager.activeTurnId = 'chatgpt-4';

    assert.equal(manager._maybeApplyPendingAutoBottomJumpPin(), true);
    assert.equal(manager.temporaryPin.scrollTop, 450);

    const pins = manager.ui.timelineBar.querySelectorAll('.timeline-pin-marker');
    assert.equal(pins.length, 1);
    assert.equal(pins[0].classList.contains('timeline-pin-marker-flash'), false);
    assert.equal(manager.ui.timelineBar.querySelector('.timeline-pin-marker-flash'), null);
});

test('auto bottom jump still uses the pre-jump position after scroll sync overwrites the latest snapshot', () => {
    const { manager, document } = createManager();
    const first = makeMarker(document, 'chatgpt-1');
    const second = makeMarker(document, 'chatgpt-2');
    const third = makeMarker(document, 'chatgpt-3');
    const fourth = makeMarker(document, 'chatgpt-4');
    manager.markers = [first, second, third];
    manager.firstUserTurnOffset = 100;
    manager.contentSpanPx = 1000;
    manager.scrollContainer = { scrollTop: 450 };
    manager.activeTurnId = 'chatgpt-1';
    manager._recordScrollSnapshot();

    manager.scrollContainer.scrollTop = 1200;
    manager.activeTurnId = 'chatgpt-3';
    manager._recordScrollSnapshot();

    assert.equal(manager._captureAutoBottomJumpCandidate(3, 4), true);

    manager.markers = [first, second, third, fourth];
    manager.activeTurnId = 'chatgpt-4';

    assert.equal(manager._maybeApplyPendingAutoBottomJumpPin(), true);
    assert.equal(manager.temporaryPin.scrollTop, 450);
});

test('auto bottom jump prefers the scroll position captured at message send', () => {
    const { manager, document } = createManager();
    const first = makeMarker(document, 'chatgpt-1');
    const second = makeMarker(document, 'chatgpt-2');
    const third = makeMarker(document, 'chatgpt-3');
    const fourth = makeMarker(document, 'chatgpt-4');
    manager.markers = [first, second, third];
    manager.firstUserTurnOffset = 100;
    manager.contentSpanPx = 1000;
    manager.scrollContainer = { scrollTop: 450 };
    manager.activeTurnId = 'chatgpt-1';

    assert.equal(manager._capturePotentialMessageSendSnapshot(), true);

    manager.scrollContainer.scrollTop = 1200;
    manager.activeTurnId = 'chatgpt-3';
    manager._recordScrollSnapshot();

    assert.equal(manager._captureAutoBottomJumpCandidate(3, 4), true);
    assert.equal(manager.pendingAutoBottomJump.scrollTop, 450);

    manager.markers = [first, second, third, fourth];
    manager.activeTurnId = 'chatgpt-4';

    assert.equal(manager._maybeApplyPendingAutoBottomJumpPin(), true);
    assert.equal(manager.temporaryPin.scrollTop, 450);
});

test('auto bottom jump does not reuse a stale middle position when message send starts at the bottom', () => {
    const { manager, document } = createManager();
    const first = makeMarker(document, 'chatgpt-1');
    const second = makeMarker(document, 'chatgpt-2');
    const third = makeMarker(document, 'chatgpt-3');
    manager.markers = [first, second, third];
    manager.firstUserTurnOffset = 100;
    manager.contentSpanPx = 1000;
    manager.scrollContainer = { scrollTop: 450 };
    manager.activeTurnId = 'chatgpt-1';
    manager._recordScrollSnapshot();

    manager.scrollContainer.scrollTop = 1200;
    manager.activeTurnId = 'chatgpt-3';
    manager._recordScrollSnapshot();

    assert.equal(manager._capturePotentialMessageSendSnapshot(), false);
    assert.equal(manager._captureAutoBottomJumpCandidate(3, 4), false);
    assert.equal(manager.pendingAutoBottomJump, null);
});

test('sync scroll position save starts storage write immediately for page close handlers', () => {
    const writes = [];
    const { manager } = createManager({
        StorageAdapter: {
            set: (key, value) => {
                writes.push([key, value]);
                return Promise.resolve();
            },
        },
    });
    manager.scrollContainer = { scrollTop: 321 };

    assert.equal(manager.requestScrollPositionSave(), true);
    assert.equal(writes.length, 1);
    assert.equal(writes[0][0], 'chatTimelineScrollPosition:chatgpt.com/c/test');
    assert.equal(writes[0][1].scrollTop, 321);
});

test('auto bottom jump flashes a candidate marker without replacing an existing pin', async () => {
    const { manager, document } = createManager();
    const first = makeMarker(document, 'chatgpt-1');
    const second = makeMarker(document, 'chatgpt-2');
    const third = makeMarker(document, 'chatgpt-3');
    manager.markers = [first, second, third];
    manager.firstUserTurnOffset = 100;
    manager.contentSpanPx = 1000;
    manager.scrollContainer = { scrollTop: 100 };
    manager.activeTurnId = 'chatgpt-3';

    await manager.toggleCurrentTemporaryPin();
    manager.pendingAutoBottomJump = {
        scrollTop: 450,
        previousCount: 3,
        currentCount: 4,
        createdAt: Date.now(),
        expiresAt: Date.now() + 2500,
    };
    manager.scrollContainer.scrollTop = 1200;

    assert.equal(manager._maybeApplyPendingAutoBottomJumpPin(), true);
    assert.equal(manager.temporaryPin.scrollTop, 100);

    const flashPin = manager.ui.timelineBar.querySelector('.timeline-pin-marker-flash');
    assert.ok(flashPin);

    flashPin.dispatchEvent({ type: 'click' });

    assert.equal(manager.temporaryPin.scrollTop, 450);
    assert.equal(manager.ui.timelineBar.querySelector('.timeline-pin-marker-flash'), null);
});

test('flashing auto bottom jump candidate expires after six seconds without changing the current pin', async () => {
    const timers = [];
    const { manager, document } = createManager({
        setTimeout: (callback, delay) => {
            const timer = { callback, delay, cleared: false };
            timers.push(timer);
            return timer;
        },
        clearTimeout: (timer) => {
            if (timer) timer.cleared = true;
        },
    });
    const first = makeMarker(document, 'chatgpt-1');
    const second = makeMarker(document, 'chatgpt-2');
    manager.markers = [first, second];
    manager.firstUserTurnOffset = 100;
    manager.contentSpanPx = 1000;
    manager.scrollContainer = { scrollTop: 100 };
    manager.activeTurnId = 'chatgpt-2';

    await manager.toggleCurrentTemporaryPin();
    manager.pendingAutoBottomJump = {
        scrollTop: 450,
        previousCount: 2,
        currentCount: 3,
        createdAt: Date.now(),
        expiresAt: Date.now() + 2500,
    };
    manager.scrollContainer.scrollTop = 1200;

    assert.equal(manager._maybeApplyPendingAutoBottomJumpPin(), true);

    const flashTimer = timers.find(timer => timer.delay === 6000);
    assert.ok(flashTimer);
    flashTimer.callback();

    assert.equal(manager.temporaryPin.scrollTop, 100);
    assert.equal(manager.ui.timelineBar.querySelector('.timeline-pin-marker-flash'), null);
});

test('saving scroll position stores current position for the current chat URL', async () => {
    const stored = new Map();
    const { manager } = createManager({
        StorageAdapter: {
            set: async (key, value) => stored.set(key, value),
            get: async (key) => stored.get(key),
        },
    });
    manager.scrollContainer = { scrollTop: 732 };

    assert.equal(await manager.saveScrollPosition(), true);

    const saved = stored.get('chatTimelineScrollPosition:chatgpt.com/c/test');
    assert.equal(saved.scrollTop, 732);
    assert.equal(saved.url, 'https://chatgpt.com/c/test');
    assert.equal(saved.urlWithoutProtocol, 'chatgpt.com/c/test');
});

test('restoring scroll position jumps the same chat to the saved position once', async () => {
    const { manager } = createManager({
        StorageAdapter: {
            get: async () => ({ scrollTop: 512, timestamp: Date.now() }),
        },
    });
    manager.scrollContainer = { scrollTop: 0 };
    let syncCount = 0;
    manager.scheduleScrollSync = () => {
        syncCount++;
    };

    assert.equal(await manager.restoreSavedScrollPosition(), true);
    assert.equal(manager.scrollContainer.scrollTop, 512);
    assert.equal(syncCount, 1);

    manager.scrollContainer.scrollTop = 64;
    assert.equal(await manager.restoreSavedScrollPosition(), false);
    assert.equal(manager.scrollContainer.scrollTop, 64);
});

test('conversation observer ignores unrelated childList mutations', () => {
    const observers = [];
    class CapturingMutationObserver {
        constructor(callback) {
            this.callback = callback;
            observers.push(this);
        }
        observe(target, options) {
            this.target = target;
            this.options = options;
        }
        disconnect() {}
    }

    const { manager, document } = createManager({ MutationObserver: CapturingMutationObserver });
    const conversation = document.createElement('main');
    document.body.appendChild(conversation);
    manager.conversationContainer = conversation;
    manager.scrollContainer = document.body;
    manager.ui.trackContent = document.createElement('div');
    manager.ui.timelineBar.appendChild(manager.ui.trackContent);

    let recalculations = 0;
    let containerChecks = 0;
    manager.debouncedRecalculateAndRender = () => {
        recalculations++;
    };
    manager.ensureContainersUpToDate = () => {
        containerChecks++;
    };
    manager.updateIntersectionObserverTargets = () => {};
    manager.setupDomCheckObserver = () => {};

    manager.setupObservers();
    const conversationObserver = observers[0];

    const unrelatedNode = document.createElement('div');
    conversationObserver.callback([
        { type: 'childList', addedNodes: [unrelatedNode], removedNodes: [] },
    ]);

    assert.equal(recalculations, 0);
    assert.equal(containerChecks, 0);

    const userTurn = document.createElement('article');
    userTurn.setAttribute('data-turn', 'user');
    userTurn.setAttribute('data-turn-id', 'abc');
    conversationObserver.callback([
        { type: 'childList', addedNodes: [userTurn], removedNodes: [] },
    ]);

    assert.equal(recalculations, 1);
    assert.equal(containerChecks, 0);
});
