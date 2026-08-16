# Agent 指令

## 项目边界
- 本项目是可直接加载的 Manifest V3 浏览器扩展；没有 `package.json`、包管理器或前端构建步骤。
- `manifest.json` 是实际运行范围与脚本注入顺序的唯一事实来源。
- 当前启用范围是 ChatGPT 时间线与收藏相关能力；仓库中未被 `manifest.json` 注入的旧模块默认视为停用代码，不要顺手接回。

## 命令
| 任务 | 命令 |
| --- | --- |
| 运行单个测试（示例） | `node --test tests/manifest-minimal.test.js` |
| 运行全部测试 | `node --test tests/*.test.js` |
| 检查单个 JavaScript 文件语法（示例） | `node --check js/timeline/index.js` |
| 检查补丁空白错误 | `git diff --check` |
| 打包 Chrome 版本 | `node scripts/build-chrome.js` |
| 打包 Firefox 版本 | `node scripts/build-firefox.js` |

## 外部参考
| 需要了解的内容 | 文件 |
| --- | --- |
| 产品目标、视觉原则与无障碍基线 | `PRODUCT.md` |
| 本地加载、功能与发布渠道 | `README.md`、`README.cn.md` |
| 新增平台 Bridge 的接口约束 | `js/bridge/BRIDGE_SPEC.md` |
| 已解决的 ChatGPT 虚拟列表问题 | `.planning/debug/resolved/timeline-initial-two-items.md` |

## 关键约定
- 内容脚本依赖 `manifest.json` 中的加载顺序和浏览器全局对象；不要无依据改成 ESM、打包器或新增运行时依赖。
- 修改注入文件或权限时，同步更新 `tests/manifest-minimal.test.js`。
- 修改 ChatGPT DOM 识别、API 捕获或虚拟列表逻辑时，运行 `tests/chatgpt-virtualization.test.js`。
- 修改时间线交互、布局或样式时，运行 `tests/timeline-temp-pin.test.js` 和 `tests/chatgpt-native-toc.test.js`。
- 新增或修改 Bridge 时遵守 `js/bridge/BRIDGE_SPEC.md`；同步读取失败必须降级为空值，事件订阅必须可注销。
- UI 保持克制且不遮挡对话；键盘焦点、非纯颜色状态表达和 `prefers-reduced-motion` 以 `PRODUCT.md` 为准。
- 不直接编辑根目录的版本化 `.zip` 包；通过 `scripts/` 中的打包脚本重新生成。
