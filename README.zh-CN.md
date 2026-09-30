<div align="center">

<img src="icon.png" width="112" alt="ParaRead 图标">

# ParaRead

**鼠标指向论文里的句子，译文就在它旁边的同一高度。**
在 VS Code 里逐句对照阅读外文 PDF 论文。

[![CI](https://github.com/Chuanyunux/pararead/actions/workflows/ci.yml/badge.svg)](https://github.com/Chuanyunux/pararead/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Chuanyunux/pararead)](https://github.com/Chuanyunux/pararead/releases)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-%E2%89%A5%201.95-007ACC)](https://code.visualstudio.com/)

[English](README.md) · **简体中文**

</div>

![鼠标停在句子上：箭头指向对应的译文，两者在同一高度对齐](demos/demo-hover.gif)

<!-- 更多演示（demos/）：demo-panel.gif（显示原文、切换语言）、demo-setup.gif（设置翻译服务）。 -->

## 为什么用 ParaRead

读外文论文时，整篇翻译看不出原文说了什么，逐段复制翻译又要不停切换窗口。ParaRead 把译文放在原文旁边，**一句对一句**：

- 🎯 **逐句对照**：鼠标停在句子上，原句加框，一条箭头指向对应的译文，两者保持在同一水平线；滚动论文时译文跟着滚。
- 📄 **保留原文格式**：译文面板按标题、段落、列表、图表说明、脚注、代码排版，像一篇正式文档，而不是一句一行的列表。
- 🌐 **11 种语言任意互译**：简体中文、繁體中文、English、日本語、한국어、Français、Deutsch、Español、Português、Русский、Italiano。论文语言逐句自动识别，中文、日文论文按全角标点分句。插件界面支持中文和英文，跟随 VS Code。
- ✍️ **仍然是完整的 PDF 阅读器**：高亮、批注、手绘都能用，`Ctrl+S` 直接保存回 PDF。

## 三步上手

1. 在 [VS Code 插件市场](https://marketplace.visualstudio.com/items?itemName=chuanyunux.pararead)安装 **ParaRead**（扩展视图中搜索 “ParaRead”），或从 [Releases](https://github.com/Chuanyunux/pararead/releases) 下载 `.vsix`，运行 **Extensions: Install from VSIX...**。
2. 命令面板运行 **ParaRead: 设置翻译服务**，选择服务商（默认 [DeepSeek](https://platform.deepseek.com/)），确认模型名并填入 API Key。
3. 用 VS Code 打开任意 PDF。第一次打开时会确认译文语言（默认跟随 VS Code 界面语言）；正在阅读的页面会自动翻译，把鼠标放到句子上即可对照。

需要 VS Code 1.95 或更高版本。

## 使用方法

| 操作                   | 效果                                           |
| ---------------------- | ---------------------------------------------- |
| 鼠标停在句子上         | 选中这一句：加框、箭头指向译文、译文与原句对齐 |
| 单击 / Alt+单击句子    | 选中并立即翻译它所在的段落                     |
| 单击空白处 / `Esc`     | 取消选中                                       |
| 在译文上悬停 / 单击    | 反向定位原句（单击会滚动到原句）               |
| 面板顶部「显示原文」   | 勾选后在每段译文下方显示对应的原文             |
| 面板顶部语言按钮       | 显示当前译文语言，单击可切换                   |
| 工具栏面板图标         | 显示 / 隐藏译文面板；分隔条可拖动调整宽度      |
| **ParaRead: 翻译整篇** | 确认后翻译全文，显示进度，可随时取消           |

## 与同类工具的区别

|                                                  | ParaRead | 沉浸式翻译 | PDFMathTranslate     | 其他 VS Code 翻译插件 |
| ------------------------------------------------ | -------- | ---------- | -------------------- | --------------------- |
| 在 VS Code 内阅读                                | ✅       | ❌ 浏览器  | ❌ 独立工具 / Zotero | ✅                    |
| 逐句对照、原文译文同高对齐                       | ✅       | ❌         | ❌                   | ❌                    |
| 译文保留段落、标题等结构                         | ✅       | ✅         | ✅（生成新 PDF）     | 多为纯文本            |
| 标注保存回原 PDF                                 | ✅       | ❌         | ❌                   | 部分支持              |
| 自选模型（DeepSeek / OpenAI 兼容 / 本地 Ollama） | ✅       | ✅         | ✅                   | 视插件而定            |

如果你需要一份排版完全保留的翻译版 PDF，PDFMathTranslate 更合适；如果你想**边读原文边对照译文**，试试 ParaRead。

## 模型、费用与隐私

- **默认使用 DeepSeek**（`deepseek-flash`），也支持任意 OpenAI 兼容接口。「设置翻译服务」内置 DeepSeek、OpenAI、通义千问、Kimi、智谱 GLM、硅基流动、OpenRouter、Google Gemini、Ollama、LM Studio 的地址和建议模型；使用本地 [Ollama](https://ollama.com/) 时完全离线、无需 API Key。
- **按句缓存**：译文按句保存在本机，重新打开论文不再调用接口，不重复计费。**ParaRead** 输出频道会记录每次调用的 token 用量。
- **只发送需要翻译的句子**到你配置的接口；API Key 保存在 VS Code 的安全存储中，不写入任何文件，也不会进入网页视图（网页视图本身不能联网）。
- 缓存保存在 VS Code 为扩展分配的目录（可用 `pararead.cacheDir` 修改），**不会**在论文所在目录写入文件；除你主动保存标注外，不会修改 PDF。

<details>
<summary>全部设置</summary>

| 设置                          | 默认值                     | 说明                                                                                                                  |
| ----------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `pararead.baseUrl`            | `https://api.deepseek.com` | OpenAI 兼容接口地址；Ollama 用 `http://localhost:11434/v1`                                                            |
| `pararead.model`              | `deepseek-flash`           | 翻译服务的模型名                                                                                                      |
| `pararead.targetLanguage`     | `auto`                     | 译文语言；`auto` 跟随 VS Code 界面语言，也可选 `zh-CN`、`zh-TW`、`en`、`ja`、`ko`、`fr`、`de`、`es`、`pt`、`ru`、`it` |
| `pararead.sourceLanguage`     | `auto`                     | 论文原文的语言；`auto` 逐句自动识别，识别不准时可指定                                                                 |
| `pararead.temperature`        | `0.7`                      | 越低术语译法越一致                                                                                                    |
| `pararead.extraBody`          | `{}`                       | 附加请求字段；服务需要的字段自动添加（DeepSeek 自动关闭思考模式）                                                     |
| `pararead.translateRange`     | `nearby`                   | 自动翻译范围：`page` 当前页 / `nearby` 当前页及前后页 / `manual` 仅手动                                               |
| `pararead.glossary`           | `{}`                       | 术语表，例如 `{"attention": "注意力"}`；也可按语言设置：`{"ja": {"attention": "アテンション"}}`                       |
| `pararead.selectOnHover`      | `true`                     | 鼠标悬停即选中；关闭后仅单击选中                                                                                      |
| `pararead.maxCharsPerRequest` | `3000`                     | 单次请求的原文字符上限                                                                                                |
| `pararead.requestTimeout`     | `60000`                    | 请求超时（毫秒）                                                                                                      |
| `pararead.cacheDir`           | 空                         | 自定义缓存目录                                                                                                        |

</details>

## 常见问题

**会上传整个 PDF 吗？** 不会。只有需要翻译的句子文本会发送到你配置的接口，PDF 文件本身不会离开本机。

**双栏论文效果如何？** 支持双栏、被图表打断的段落、跨栏续写的段落。当前的限制是：跨页的句子会被拆成两句，整行公式可能被当作句子，标题页的作者列表可能被识别成标题。

**支持哪些语言的论文？** 横排的中文、日文、韩文、俄文和英、法、德、西、葡、意文论文。竖排版面和从右向左书写的语言（如阿拉伯语）暂不支持。

**面板里显示的是原文，没有翻译？** 译文语言没有设置时跟随 VS Code 界面语言。英文界面下读英文论文，句子已经是“译文语言”，所以按原文显示。单击面板顶部的语言按钮，或运行命令 **ParaRead: 选择译文语言**即可更改。

**可以只用本地模型吗？** 可以。运行「设置翻译服务」选择 Ollama 或 LM Studio，填入本地已下载的模型名即可，无需 API Key。

**支持哪些服务？** 任何兼容 OpenAI `/chat/completions` 接口、支持 JSON 输出模式的服务。Azure OpenAI（鉴权方式不同）和只提供原生接口的服务暂不支持，可通过 OpenRouter 等兼容网关接入；部分推理模型不接受 `temperature` 或 `max_tokens`，建议选普通对话模型。

**会影响我已有的 PDF 标注吗？** 不会。ParaRead 的选中框只是临时显示，不写入 PDF；鼠标在已有标注上时也不会触发选中。

## 路线图

- [ ] 学习模式：译文默认模糊，点击后显示
- [ ] 导出双语对照 Markdown
- [ ] 生词本：Alt+双击单词查词、导出 Anki
- [ ] 上架 Open VSX

欢迎在 [Issues](https://github.com/Chuanyunux/pararead/issues) 中提需求和反馈问题。

## 开发

```sh
pnpm install
pnpm run build      # 构建扩展与网页视图
pnpm test           # 单元测试（首次运行会从 arXiv 下载测试论文）
pnpm run check      # 类型检查、lint、格式检查
```

在 VS Code 中按 `F5` 启动扩展调试窗口；也可以运行 `pnpm run harness`，在浏览器中打开 `http://localhost:5178/?pdf=papers/<文件>.pdf` 调试网页视图（`papers/` 不纳入版本控制）。贡献方式见 [CONTRIBUTING.md](CONTRIBUTING.md)，首次提交 PR 需签署 [贡献者许可协议](CLA.md)。更新 PDF.js 的步骤见[英文 README](README.md#updating-pdfjs)。

## 致谢与许可

ParaRead 基于 Mathematic Inc 的 [vscode-pdf](https://github.com/mathematic-inc/vscode-pdf) 修改，并内置 Mozilla 的 [PDF.js](https://mozilla.github.io/pdf.js/)，两者均采用 Apache-2.0 许可。ParaRead 与这两个项目没有关联，也未获得其认可。

采用 [Apache-2.0](LICENSE) 许可，另见 [NOTICE](NOTICE)。
