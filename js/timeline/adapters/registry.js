/**
 * Adapter Registry
 * 
 * Manages all site adapters and provides auto-detection
 */

class SiteAdapterRegistry {
    constructor() {
        this.builtInAdapters = [];
        this.customAdapters = [];
        this._registerBuiltInAdapters();
        this.adapters = [...this.builtInAdapters];
    }

    /**
     * 注册单个内置适配器，并挂上 platformId（与 SITE_INFO 的 id 一致）。
     */
    _registerAdapter(platformId, adapter) {
        if (!platformId || !adapter) return;
        adapter.platformId = platformId;
        this.builtInAdapters.push(adapter);
    }

    /**
     * 注册所有内置适配器。
     */
    _registerBuiltInAdapters() {
        this._registerAdapter('chatgpt', new ChatGPTAdapter());
    }

    loadCustomAdapters() {
        this.customAdapters = [];
        this.adapters = [...this.builtInAdapters];
    }

    /**
     * Detect and return the appropriate adapter for current site
     * @returns {Promise<SiteAdapter|null>}
     */
    async detectAdapter() {
        const url = location.href;
        for (const adapter of this.adapters) {
            if (await adapter.matches(url)) {
                return adapter;
            }
        }
        return null;
    }

    /**
     * Check if current site is supported
     * @returns {Promise<boolean>}
     */
    async isSupportedSite() {
        return (await this.detectAdapter()) !== null;
    }

    /**
     * 获取全部已注册适配器。
     * @returns {Array<SiteAdapter>}
     */
    getAllAdapters() {
        return [...this.adapters];
    }
}

// 全局只读单例：当前精简版只保留 ChatGPT 时间轴适配器。
if (typeof window.siteAdapterRegistry === 'undefined') {
    window.siteAdapterRegistry = new SiteAdapterRegistry();
}
