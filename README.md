<div align="center">

<img src="icon.png" width="112" alt="ParaRead icon">

# ParaRead

**鼠标指向英文句子，译文就在它旁边的同一高度。**
在 VS Code 里逐句对照阅读英文 PDF 论文。

[![CI](https://github.com/Chuanyunux/pararead/actions/workflows/ci.yml/badge.svg)](https://github.com/Chuanyunux/pararead/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Chuanyunux/pararead)](https://github.com/Chuanyunux/pararead/releases)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-%E2%89%A5%201.95-007ACC)](https://code.visualstudio.com/)

**中文** · [English](#english)

</div>

<!-- Demo: docs/demo.gif — hover a sentence → arrow → aligned translation → scroll in sync. -->

## 为什么用 ParaRead

读英文论文时，整篇翻译看不出原文说了什么，逐段复制翻译又要不停切换窗口。ParaRead 把译文放在原文旁边，**一句对一句**：

- 🎯 **逐句对照**：鼠标停在句子上，原句加框，一条箭头指向对应的译文，两者保持在同一水平线；滚动论文时译文跟着滚。
- 📄 **保留原文格式**：译文面板按标题、段落、列表、图表说明、脚注、代码排版，像一篇正式文档，而不是一句一行的列表。
- 🌐 **译成 11 种语言**：简体中文、繁體中文、English、日本語、한국어、Français、Deutsch、Español、Português、Русский、Italiano，默认跟随 VS Code 界面语言。插件界面支持中文和英文，同样跟随 VS Code。
- ✍️ **仍然是完整的 PDF 阅读器**：高亮、批注、手绘都能用，`Ctrl+S` 直接保存回 PDF。

## 三步上手

1. 从 [Releases](https://github.com/Chuanyunux/pararead/releases) 下载 `.vsix`，在 VS Code 中运行 **Extensions: Install from VSIX...**。
2. 命令面板运行 **ParaRead: 设置 API Key**，填入 [DeepSeek](https://platform.deepseek.com/) 的 API Key。
3. 用 VS Code 打开任意 PDF。正在阅读的页面会自动翻译，把鼠标放到句子上即可对照。

需要 VS Code 1.95 或更高版本。

## 使用方法

| 操作                   | 效果                                           |
| ---------------------- | ---------------------------------------------- |
| 鼠标停在句子上         | 选中这一句：加框、箭头指向译文、译文与原句对齐 |
| 单击 / Alt+单击句子    | 选中并立即翻译它所在的段落                     |
| 单击空白处 / `Esc`     | 取消选中                                       |
| 在译文上悬停 / 单击    | 反向定位原句（单击会滚动到原句）               |
| 面板顶部「原文」       | 在每段译文下显示英文原文                       |
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

- **默认使用 DeepSeek**（`deepseek-flash`），也支持任意 OpenAI 兼容接口；使用本地 [Ollama](https://ollama.com/) 时完全离线、无需 API Key。
- **按句缓存**：译文按句保存在本机，重新打开论文不再调用接口，不重复计费。**ParaRead** 输出频道会记录每次调用的 token 用量。
- **只发送需要翻译的句子**到你配置的接口；API Key 保存在 VS Code 的安全存储中，不写入任何文件，也不会进入网页视图（网页视图本身不能联网）。
- 缓存保存在 VS Code 为扩展分配的目录（可用 `pararead.cacheDir` 修改），**不会**在论文所在目录写入文件；除你主动保存标注外，不会修改 PDF。

<details>
<summary>全部设置</summary>

| 设置                          | 默认值                               | 说明                                                                                                                  |
| ----------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `pararead.baseUrl`            | `https://api.deepseek.com`           | OpenAI 兼容接口地址；Ollama 用 `http://localhost:11434/v1`                                                            |
| `pararead.targetLanguage`     | `auto`                               | 译文语言；`auto` 跟随 VS Code 界面语言，也可选 `zh-CN`、`zh-TW`、`en`、`ja`、`ko`、`fr`、`de`、`es`、`pt`、`ru`、`it` |
| `pararead.model`              | `deepseek-flash`                     | 模型名，例如 `deepseek-v4-pro`                                                                                        |
| `pararead.temperature`        | `0.7`                                | 越低术语译法越一致                                                                                                    |
| `pararead.extraBody`          | `{"thinking": {"type": "disabled"}}` | 附加请求字段；DeepSeek 默认开启思考模式，翻译时关闭。其他服务可设为 `{}`                                              |
| `pararead.translateRange`     | `nearby`                             | 自动翻译范围：`page` 当前页 / `nearby` 当前页及前后页 / `manual` 仅手动                                               |
| `pararead.glossary`           | `{}`                                 | 术语表，例如 `{"attention": "注意力"}`；也可按语言设置：`{"ja": {"attention": "アテンション"}}`                       |
| `pararead.selectOnHover`      | `true`                               | 鼠标悬停即选中；关闭后仅单击选中                                                                                      |
| `pararead.maxCharsPerRequest` | `3000`                               | 单次请求的原文字符上限                                                                                                |
| `pararead.requestTimeout`     | `60000`                              | 请求超时（毫秒）                                                                                                      |
| `pararead.cacheDir`           | 空                                   | 自定义缓存目录                                                                                                        |

</details>

## 常见问题

**会上传整个 PDF 吗？** 不会。只有需要翻译的句子文本会发送到你配置的接口，PDF 文件本身不会离开本机。

**双栏论文效果如何？** 支持双栏、被图表打断的段落、跨栏续写的段落。当前的限制是：跨页的句子会被拆成两句，整行公式可能被当作句子，标题页的作者列表可能被识别成标题。

**可以只用本地模型吗？** 可以。把 `pararead.baseUrl` 设为本地 Ollama 地址、`pararead.extraBody` 设为 `{}` 即可，无需 API Key。

**会影响我已有的 PDF 标注吗？** 不会。ParaRead 的选中框只是临时显示，不写入 PDF；鼠标在已有标注上时也不会触发选中。

## 路线图

- [ ] 学习模式：译文默认模糊，点击后显示
- [ ] 导出双语对照 Markdown
- [ ] 生词本：Alt+双击单词查词、导出 Anki
- [ ] 上架 VS Code 插件市场与 Open VSX

欢迎在 [Issues](https://github.com/Chuanyunux/pararead/issues) 中提需求和反馈问题。

## 开发

```sh
pnpm install
pnpm run build      # 构建扩展与网页视图
pnpm test           # 单元测试（首次运行会从 arXiv 下载测试论文）
pnpm run check      # 类型检查、lint、格式检查
```

在 VS Code 中按 `F5` 启动扩展调试窗口；也可以运行 `pnpm run harness`，在浏览器中打开 `http://localhost:5178/?pdf=papers/<文件>.pdf` 调试网页视图（`papers/` 不纳入版本控制）。贡献方式见 [CONTRIBUTING.md](CONTRIBUTING.md)，首次提交 PR 需签署 [贡献者许可协议](CLA.md)。

---

<a id="english"></a>

## English

**ParaRead** — hover over an English sentence and its translation sits right beside it, at the same height. A sentence-by-sentence bilingual reader for English PDF papers in VS Code, translating into 11 languages: Chinese (Simplified and Traditional), Japanese, Korean, French, German, Spanish, Portuguese, Russian, Italian and English. The target language follows the VS Code display language by default (`pararead.targetLanguage`).

- 🎯 **Sentence linking**: hovering a sentence outlines it, draws an arrow to its translation and keeps both level; the translation scrolls with the paper. Click to translate its paragraph right away; click empty space or press `Esc` to clear.
- 📄 **Layout-preserving translation panel**: headings, paragraphs, lists, captions, footnotes and code, page by page, with an optional view of the original.
- ✍️ **Still a full PDF reader**: PDF.js highlight, comment and drawing tools; `Ctrl+S` saves annotations into the PDF.
- 🔌 **Your model**: DeepSeek by default, any OpenAI-compatible API, or a local Ollama (fully offline). Translations are cached per sentence, so reopening a paper costs nothing.

**Install**: download the `.vsix` from [Releases](https://github.com/Chuanyunux/pararead/releases), run **Extensions: Install from VSIX...** (VS Code ≥ 1.95), then **ParaRead: Set API Key** and open a PDF. The interface is in English or Chinese, following VS Code.

**Privacy**: only the sentences to translate are sent to the configured API. The API key lives in VS Code's secret storage and never reaches the webview, which has no network access. PDFs are only modified when you save annotations.

**Development**: `pnpm install`, `pnpm run build`, `pnpm test` (downloads a test paper from arXiv on first run), `pnpm run check`; press `F5` in VS Code to debug.

### Updating PDF.js

- Update `pdfjs_version.txt` to the target version and hash.
- Run `tools/prepare_pdfjs.sh` from the repository root. It downloads PDF.js and applies the patches in `patches/`; on conflicts, resolve the generated `*.rej` files in `assets/pdf.js` and delete them.
- To add patches while keeping the current version, run it with `--update-patches`, edit `assets/pdf.js` when prompted, and the script regenerates the patch. It does not create commits.

## Credits & License

ParaRead is a modified version of [vscode-pdf](https://github.com/mathematic-inc/vscode-pdf) by Mathematic Inc and bundles [PDF.js](https://mozilla.github.io/pdf.js/) by Mozilla, both licensed under Apache-2.0. It is not affiliated with or endorsed by either project.

Licensed under [Apache-2.0](LICENSE); see [NOTICE](NOTICE).
