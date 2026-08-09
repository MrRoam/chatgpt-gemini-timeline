# Pin 位置替换实现计划

> **供自动化执行者使用：** 必须使用 `superpowers:executing-plans` 逐项执行本计划。每个步骤使用复选框跟踪。

**目标：** 让工具栏 Pin 按钮始终把唯一的临时 Pin 设置到当前滚动位置，不再提供 Unpin 开关行为。

**架构：** 复用 `TimelineManager.setTemporaryPinAtScrollTop(scrollTop)` 已有的覆盖与重绘能力，只调整入口方法和按钮语义。测试通过真实 `TimelineManager` 与测试 DOM 验证第二次点击替换位置、标记数量保持为一，以及按钮始终是动作按钮。

**技术栈：** Manifest V3 内容脚本、浏览器全局对象、原生 JavaScript、Node.js 内置测试运行器。

## 全局约束

- 不引入 `package.json`、包管理器、构建步骤或运行时依赖。
- 不修改 `manifest.json` 的注入范围或顺序。
- 临时 Pin 只保存在当前页面内存中，不写入 `chrome.storage`。
- 不修改自动跳到底部候选 Pin、黄色标记导航或时间轴布局。
- Pin 按钮始终使用 `Pin chat`，不出现 `Unpin`，不使用 `aria-pressed` 开关语义。
- 目标文件已有用户未提交改动；只修改本计划列出的局部代码，不提交或覆盖其他改动。

---

### 任务 1：把 Pin 开关改为位置替换动作

**文件：**

- 修改：`tests/timeline-temp-pin.test.js:341-432`
- 修改：`js/timeline/timeline-manager.js:470-498`
- 修改：`js/timeline/timeline-manager.js:2529-2556`

**接口：**

- 使用：`TimelineManager.setTemporaryPinAtScrollTop(scrollTop, sourceMarkerId = null): boolean`
- 修改：`TimelineManager.toggleCurrentTemporaryPin(): Promise<boolean>`
- 保留：`TimelineManager.updateTempPinButtonState(): void`
- 产生行为：每次点击以当前 `scrollContainer.scrollTop` 覆盖 `temporaryPin`；按钮始终保持动作语义。

- [ ] **步骤 1：先写会失败的替换位置测试**

把现有首次 Pin 测试的第二次点击断言改为真实的位置替换断言：

```js
manager.scrollContainer.scrollTop = 840;
const replaced = await manager.toggleCurrentTemporaryPin();

assert.equal(replaced, true);
assert.equal(manager.temporaryPin.scrollTop, 840);
assert.equal(manager.ui.timelineBar.querySelectorAll('.timeline-pin-marker').length, 1);
assert.equal(manager.ui.timelineBar.querySelector('.timeline-pin-marker').getAttribute('aria-label'), 'Return to pinned answer');
```

这个测试防止 `toggleCurrentTemporaryPin()` 在已有 Pin 时调用 `clearTemporaryPin()`。

- [ ] **步骤 2：先写会失败的按钮语义测试**

把按钮开关测试改名为 `Pin toolbar button stays an action while replacing the saved position`，并断言首次与再次点击前后都没有 Unpin 或开关状态：

```js
assert.equal(pinButton.getAttribute('aria-label'), 'Pin chat');
assert.equal(pinButton.hasAttribute('aria-pressed'), false);
assert.equal(pinButton.classList.contains('active'), false);

await manager.toggleCurrentTemporaryPin();
assert.equal(pinButton.getAttribute('aria-label'), 'Pin chat');
assert.equal(pinButton.hasAttribute('aria-pressed'), false);
assert.equal(pinButton.classList.contains('active'), false);

manager.scrollContainer.scrollTop = 640;
await manager.toggleCurrentTemporaryPin();
assert.equal(manager.temporaryPin.scrollTop, 640);
assert.equal(pinButton.getAttribute('aria-label'), 'Pin chat');
assert.equal(pinButton.hasAttribute('aria-pressed'), false);
assert.equal(pinButton.classList.contains('active'), false);
```

这个测试防止按钮重新引入 `Unpin`、`aria-pressed` 或激活外观。

- [ ] **步骤 3：运行目标测试并确认按预期失败**

运行：

```powershell
node --test tests/timeline-temp-pin.test.js
```

预期：至少上述两个测试失败；失败原因分别是第二次点击清空 `temporaryPin`，以及按钮当前仍包含 `aria-pressed` 或切换到 `Unpin`。

- [ ] **步骤 4：实现最小入口修改**

将 `toggleCurrentTemporaryPin()` 改为始终设置当前位置：

```js
async toggleCurrentTemporaryPin() {
    if (!this.scrollContainer) {
        window.globalToastManager?.info?.(chrome.i18n.getMessage('pinNoTarget') || 'No answer to pin yet');
        return false;
    }

    return this.setTemporaryPinAtScrollTop(this.scrollContainer.scrollTop || 0);
}
```

- [ ] **步骤 5：移除 Pin 按钮的开关语义**

创建按钮时不设置 `aria-pressed`，并让状态同步方法始终恢复为动作按钮：

```js
updateTempPinButtonState() {
    const btn = this.ui?.tempPinBtn;
    if (!btn) return;

    btn.classList.remove('active');
    btn.removeAttribute('aria-pressed');
    btn.setAttribute('aria-label', chrome.i18n.getMessage('pinChatAction') || 'Pin chat');
}
```

- [ ] **步骤 6：运行目标测试并确认通过**

运行：

```powershell
node --test tests/timeline-temp-pin.test.js
```

预期：退出码为 0，没有失败测试。

- [ ] **步骤 7：运行项目要求的回归验证**

依次运行：

```powershell
node --check js/timeline/timeline-manager.js
node --test tests/timeline-temp-pin.test.js
node --test tests/chatgpt-native-toc.test.js
node --test tests/*.test.js
git diff --check
```

预期：所有命令退出码均为 0，测试没有失败，补丁没有空白错误。

- [ ] **步骤 8：检查最终差异但不提交混合改动**

运行：

```powershell
git diff -- js/timeline/timeline-manager.js tests/timeline-temp-pin.test.js
git status --short
```

确认本次只改变 Pin 位置替换与按钮语义。由于两个目标文件在本任务开始前已有用户未提交改动，不暂存或提交这些混合文件；在交付说明中明确这一点。
