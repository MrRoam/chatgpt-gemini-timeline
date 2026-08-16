// ChatGPT 对话接口拦截 —— MAIN world / document_start
//
// 新版 ChatGPT 会卸载视口外轮次的 DOM 与 React 子树。页面本身仍会请求完整
// conversation mapping，因此在请求发生时捕获当前分支的全部用户提问，供时间轴使用。
(() => {
  'use strict';
  if (window.__aitGptApiCapture) return;
  window.__aitGptApiCapture = true;

  const userTextsByConversation = new Map();
  const latestAppliedRequestByConversation = new Map();
  let nextRequestSequence = 0;

  const replaceTexts = (conversationId, texts) => {
    if (!conversationId) return;
    userTextsByConversation.set(conversationId, new Map(Object.entries(texts)));
  };

  const isVisibleType = message => {
    const contentType = message?.content?.content_type;
    return contentType === 'text' || contentType === 'multimodal_text';
  };
  const isForUser = message => !message?.recipient || message.recipient === 'all';
  const isModelAuthored = message => !message?.author?.name;

  const textFromMessage = message => {
    try {
      const content = message?.content;
      if (!content || /thought|reason/i.test(content.content_type || '')) return '';
      if (!Array.isArray(content.parts)) return '';
      return content.parts.filter(part => typeof part === 'string').join('\n').trim();
    } catch {
      return '';
    }
  };

  const linearize = json => {
    const mapping = json?.mapping || {};
    let current = json?.current_node;
    if (!current || !mapping[current]) {
      current = Object.keys(mapping).find(id => !(mapping[id]?.children?.length));
    }

    const chain = [];
    let guard = 0;
    while (current && mapping[current] && guard++ < 10000) {
      chain.push(mapping[current]);
      current = mapping[current].parent;
    }
    return chain.reverse();
  };

  const parseUserTexts = json => {
    const turns = [];
    let currentAssistant = null;
    linearize(json).forEach(node => {
      const message = node?.message;
      if (!message || !node.id) return;
      if (message.author?.role === 'user') {
        currentAssistant = null;
        turns.push({ role: 'user', ids: [node.id], messages: [message] });
        return;
      }
      if (!currentAssistant) {
        currentAssistant = { role: 'assistant', ids: [], messages: [] };
        turns.push(currentAssistant);
      }
      currentAssistant.ids.push(node.id);
      currentAssistant.messages.push(message);
    });

    const texts = {};
    turns.forEach(turn => {
      if (turn.role !== 'user') return;
      const text = turn.messages
        .filter(message => message.author?.role === 'user'
          && isModelAuthored(message)
          && isForUser(message)
          && isVisibleType(message))
        .map(textFromMessage)
        .filter(Boolean)
        .join('\n\n');
      if (!text) return;

      const compact = text.replace(/\s+/g, ' ').trim();
      turn.ids.forEach(id => { texts[id] = compact; });
    });
    return texts;
  };

  const capture = (conversationId, json) => {
    try {
      if (!json?.mapping) return false;
      replaceTexts(conversationId, parseUserTexts(json));
      document.dispatchEvent(new CustomEvent('ait-gpt-user-texts-updated', {
        detail: conversationId
      }));
      return true;
    } catch {
      return false;
    }
  };

  // POST /backend-api/conversation 是发消息流，只捕获带 id 的 GET 请求。
  const CONVERSATION_URL_RE = /\/backend-api\/conversation\/([0-9a-f][0-9a-f-]{18,})(?:[?#]|$)/i;
  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    const promise = originalFetch.apply(this, args);
    try {
      const rawUrl = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
      const method = String(
        args[1]?.method || (typeof args[0] === 'object' ? args[0]?.method : '') || 'GET'
      ).toUpperCase();
      const match = rawUrl.match(CONVERSATION_URL_RE);
      if (match && method === 'GET') {
        const conversationId = match[1];
        const requestSequence = ++nextRequestSequence;
        promise.then(response => {
          if (!response?.ok) return;
          response.clone().json().then(json => {
            const latestApplied = latestAppliedRequestByConversation.get(conversationId) || 0;
            if (requestSequence < latestApplied) return;
            if (capture(conversationId, json)) {
              latestAppliedRequestByConversation.set(conversationId, requestSequence);
            }
          }).catch(() => {});
        }).catch(() => {});
      }
    } catch {
      // 捕获失败不能影响 ChatGPT 自身请求。
    }
    return promise;
  };

  document.addEventListener('ait-gpt-user-texts-pull', event => {
    try {
      const conversationId = typeof event.detail === 'string' ? event.detail : '';
      const bucket = userTextsByConversation.get(conversationId);
      document.dispatchEvent(new CustomEvent('ait-gpt-user-texts-result', {
        // Firefox 跨 world 传对象存在兼容问题，统一使用 JSON 字符串。
        detail: JSON.stringify({
          conversationId,
          texts: bucket ? Object.fromEntries(bucket) : {}
        })
      }));
    } catch {
      document.dispatchEvent(new CustomEvent('ait-gpt-user-texts-result', {
        detail: JSON.stringify({ conversationId: '', texts: null })
      }));
    }
  });
})();
