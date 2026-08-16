---
status: resolved
trigger: "Timeline 打开长对话后默认只显示两个问题，只有向上滚动才会刷新出其余问题；需要对照官方仓库检查刷新策略并修复。"
created: 2026-08-02
updated: 2026-08-02
---

# 症状

- 预期行为：进入已有的长对话后，Timeline 应自动发现并显示全部提问，无需用户先滚动。
- 实际行为：初次打开时默认只能看到两个问题；向上滚动后，其余问题才逐步刷新出来。
- 错误信息：用户未报告可见报错。
- 复现方式：直接打开包含多轮问答的现有 ChatGPT 对话，观察 Timeline 初始条目数量，再向上滚动并观察条目是否增加。

# Current Focus

- hypothesis: 已确认——时间轴把当前已渲染的用户消息 DOM 当成完整数据源，无法覆盖 ChatGPT 新版虚拟化空壳。
- test: 构造六个交替轮次，其中只有末尾轮次真实渲染，验证初始化时仍能得到三个用户提问节点。
- expecting: 不滚动即可得到全部用户轮次；接口响应到达后补齐未渲染提问的文本。
- next_action: 已完成修复和回归验证。
- reasoning_checkpoint: 延长初始化延迟只能推迟扫描，无法让被虚拟化卸载的 DOM 出现；必须更换节点与文本的数据源。
- tdd_checkpoint: 新增虚拟化空壳与对话接口捕获测试，完整测试 42/42 通过。

# Evidence

- timestamp: 2026-08-02
  observation: 本地 `recalculateAndRenderMarkers()` 通过旧选择器查询当前 DOM，marker 数量完全取决于当下已挂载节点；Fiber bridge 只补文本，不补节点。
- timestamp: 2026-08-02
  observation: 官方仓库当前主分支 `0e1bec973a38bdb45d45bac5b7001e0c376b7c3f` 已改用 `[data-turn-id-container][data-is-intersecting]` 空壳推导轮次角色，并在 document_start 捕获 `/backend-api/conversation/{id}`。
- timestamp: 2026-08-02
  observation: 项目历史提交 `04e9125` 的旧 Fiber 修复依赖虚拟轮次仍保留 React 子树；新版 ChatGPT 会连同 React 子树一起卸载，因此方案已失效。
- timestamp: 2026-08-02
  observation: 新增测试在只有末尾真实轮次的六轮结构中，初始化阶段识别出 `u1/u2/u3` 三个提问，无需滚动。

# Eliminated

- hypothesis: 初始 100ms 与 500ms 两次渲染间隔太短。
  reason: 等待不会改变视口外轮次被虚拟化卸载这一事实；滚动之所以有效，是它改变了宿主页面的挂载窗口。
- hypothesis: MutationObserver 防抖时间导致遗漏。
  reason: 观察器能在向上滚动后看到新增节点并刷新，说明触发链本身可用；缺失发生在初始数据源。

# Resolution

- root_cause: ChatGPT 虚拟化策略已升级，视口外轮次只剩稳定空壳，旧代码却只统计 `[data-turn="user"][data-turn-id]` 的已渲染 DOM；因此初始只得到末尾约两个提问。旧 Fiber bridge 同样无法读取已被整体卸载的子树。
- fix: 根据官方策略，从轮次空壳倒序推导 user/assistant 角色；初始化与结构变更前显式准备节点；在 document_start 捕获 ChatGPT 完整对话接口并按会话缓存提问文本；接口数据晚到时只补摘要；结构观察器忽略普通流式内容变化。
- verification: `node --check` 全部通过，`node --test tests/*.test.js` 42/42 通过，`git diff --check` 通过。
- files_changed: manifest.json；js/apiCapture/chatgpt.js；js/timeline/adapters/base.js；js/timeline/adapters/chatgpt.js；js/timeline/container-finder.js；js/timeline/index.js；js/timeline/timeline-manager.js；tests/manifest-minimal.test.js；tests/chatgpt-virtualization.test.js；删除 js/timeline/fiber-bridge-chatgpt.js。
