# PDF Bilingual Reader

<img src="icon.png" width="96" align="right" alt="">

**中文** · [English](#english)

在 VS Code 里阅读英文论文的逐句双语对照阅读器。基于 [vscode-pdf](https://github.com/mathematic-inc/vscode-pdf) 与 [Mozilla PDF.js](https://mozilla.github.io/pdf.js/)。

## 功能

- **完整的 PDF 阅读器**：保留 PDF.js 的查看与标注能力（高亮、文本框、手绘、图章），`Ctrl+S` 把标注保存回 PDF。
- **逐句对照**：鼠标停在句子上即选中，原句加框、一条箭头指向对应译文，并让译文和原句保持在同一高度；单击选中并翻译该段，单击空白处或 `Esc` 取消。反过来在译文上悬停/单击也能定位原句。
- **保留原文格式的译文面板**：按标题、段落、列表、图表说明、脚注、代码排版；「原文」按钮可在每段下显示英文原文。滚动 PDF 时译文按段落同步滚动。
- **翻译**：支持任意 OpenAI 兼容接口，默认 DeepSeek；自动翻译当前页及前后页，也可以翻译整篇；译文按句缓存在本机，再次打开论文不再调用接口。

## 安装

1. 从 [Releases](https://github.com/OWNER/pdf-bilingual-reader/releases) 下载最新的 `.vsix` 文件。
2. 在 VS Code 中执行命令 **Extensions: Install from VSIX...**，或在终端运行：
   ```sh
   code --install-extension pdf-bilingual-reader-v0.1.0.vsix
   ```

需要 VS Code 1.95 或更高版本。

## 配置翻译

1. 命令面板运行 **PDF Bilingual: 设置 API Key**，填入 DeepSeek（或其他服务）的 API Key。
2. 打开任意 PDF，当前页和前后各一页会自动翻译（`pdfBilingual.translateRange`：`page` / `nearby` / `manual`）。
3. **PDF Bilingual: 翻译整篇** 会在确认后翻译全文，可随时取消；**清除翻译缓存** 删除所有已缓存译文。

默认设置：`baseUrl` 为 `https://api.deepseek.com`，`model` 为 `deepseek-flash`，`temperature` 为 0.7，`extraBody` 为 `{"thinking": {"type": "disabled"}}`（DeepSeek 默认开启思考模式，翻译时关闭）。

使用本地 Ollama：`baseUrl` 设为 `http://localhost:11434/v1`，`model` 设为本地模型名，`extraBody` 设为 `{}`，无需 API Key。

接口调用、缓存命中和 token 用量记录在「输出」面板的 **PDF Bilingual** 频道中。

## 隐私

- 阅读时，论文中需要翻译的句子会发送到你配置的翻译接口（默认 DeepSeek）。请勿用于不允许外发的文档，或改用本地模型。
- API Key 保存在 VS Code 的安全存储（SecretStorage）中，不写入任何文件，也不会传给网页视图；网页视图本身不能访问网络。
- 译文缓存保存在 VS Code 为扩展分配的全局存储目录（可用 `pdfBilingual.cacheDir` 修改），不会向论文所在目录写入任何文件。
- 除你主动保存标注外，扩展不会修改 PDF 文件。

## 已知限制

- 分句基于版面启发式规则：跨页的句子会被拆成两句，整行公式可能被当作句子，标题页的作者列表可能被识别为标题。
- 双栏论文在未选中句子时，同步滚动只能做到段落级别。

## 开发

```sh
pnpm install
pnpm run build      # 构建扩展与网页视图
pnpm test           # 单元测试（首次运行会从 arXiv 下载测试论文）
pnpm run check      # 类型检查、lint、格式检查
```

在 VS Code 中按 `F5` 启动扩展调试窗口。也可以在浏览器中调试网页视图：运行 `pnpm run harness`，打开 `http://localhost:5178/?pdf=papers/<文件>.pdf`（`papers/` 目录不纳入版本控制），发往扩展的消息记录在 `window.__hostMessages`。

评估分句效果：

```sh
pnpm run fixtures papers/<文件>.pdf .cache/fixtures
pnpm run segment .cache/fixtures/<文件>.p3.json                 # 单页完整输出
pnpm run segment .cache/fixtures/<文件>.p*.json --sample 50     # 随机抽样
```

贡献方式见 [CONTRIBUTING.md](CONTRIBUTING.md)。

---

## English

A sentence-level bilingual (English → Chinese) reader for papers in VS Code, built on [vscode-pdf](https://github.com/mathematic-inc/vscode-pdf) and [Mozilla PDF.js](https://mozilla.github.io/pdf.js/).

### Features

- **Full PDF viewer** with the PDF.js annotation editors; `Ctrl+S` saves annotations back into the PDF.
- **Sentence linking**: hover over a sentence to select it — it is outlined, an arrow points to its translation, and the translation is kept at the same height. Click to select it and translate its paragraph; click empty space or press `Esc` to clear. Works the other way round from the translation panel.
- **Layout-preserving translation panel**: headings, paragraphs, lists, captions, footnotes and code, page by page; an optional view of the original under each paragraph. Scrolling the PDF scrolls the translation.
- **Translation** through any OpenAI-compatible API (DeepSeek by default), for the pages being read or the whole paper, cached per sentence on disk.

### Install

Download the latest `.vsix` from [Releases](https://github.com/OWNER/pdf-bilingual-reader/releases) and run **Extensions: Install from VSIX...** in VS Code 1.95 or later.

### Setup

Run **PDF Bilingual: 设置 API Key** (set API key) from the Command Palette and open a PDF. Defaults: `baseUrl` `https://api.deepseek.com`, `model` `deepseek-flash`, `temperature` 0.7, `extraBody` `{"thinking": {"type": "disabled"}}`. For a local Ollama, set `baseUrl` to `http://localhost:11434/v1`, `extraBody` to `{}`; no key is needed.

### Privacy

Sentences to be translated are sent to the configured translation API. The API key is kept in VS Code's secret storage and never reaches the webview, which has no network access. Translations are cached in the extension's global storage. PDFs are only modified when you save annotations.

### Development

`pnpm install`, `pnpm run build`, `pnpm test` (downloads a test paper from arXiv on first run), `pnpm run check`. Press `F5` in VS Code to debug. See [CONTRIBUTING.md](CONTRIBUTING.md).

### Updating PDF.js

- Update `pdfjs_version.txt` to the target version and hash.
- Run `tools/prepare_pdfjs.sh` from the repository root. It downloads PDF.js and applies the patches in `patches/`; on conflicts, resolve the generated `*.rej` files in `assets/pdf.js` and delete them.
- To add patches while keeping the current version, run it with `--update-patches`, edit `assets/pdf.js` when prompted, and the script regenerates the patch. It does not create commits.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE). This project is a modified version of vscode-pdf by Mathematic Inc and bundles PDF.js by Mozilla, both under Apache-2.0; it is not affiliated with or endorsed by either.
