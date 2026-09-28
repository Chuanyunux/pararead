# PDF Bilingual Reader

A VS Code extension for reading English papers with sentence-level Chinese
translations, built on [vscode-pdf](https://github.com/mathematic-inc/vscode-pdf)
and [Mozilla PDF.js](https://mozilla.github.io/pdf.js/).

- Full PDF.js viewer, including the annotation editors (highlight, free text,
  ink, stamp). Annotations are saved back into the PDF with `Ctrl+S`.
- The translation panel on the right is typeset like the paper: headings,
  paragraphs, lists, captions, footnotes and code listings, page by page. The
  **原文** button shows the original under each paragraph.
- **Hover** over a sentence to select it (`pdfBilingual.selectOnHover`): it is
  highlighted, an arrow points to its translation, and the translation is
  scrolled level with it. **Click** (or Alt+click) selects it too and translates
  its paragraph; hovering keeps working afterwards. Clicking empty space or
  `Esc` clears the selection. Hovering or clicking a translation works the other
  way round.
- Scrolling the PDF scrolls the translation paragraph by paragraph; scrolling
  the panel by hand pauses this briefly.
- The panel can be resized with the splitter and toggled with the **译** button
  in the toolbar.
- Translations come from any OpenAI-compatible API — DeepSeek by default — and
  are cached per sentence on disk, so reopening a paper costs no API calls.

Status: milestone M2. See `pdf-bilingual-reader-需求.md` for the full plan.

## Translation setup

1. Run **PDF Bilingual: 设置 API Key** from the Command Palette. The key is kept
   in VS Code's secret storage and never reaches the webview.
2. Open a PDF. The current page and its neighbours are translated as you read
   (`pdfBilingual.translateRange`: `page` / `nearby` / `manual`); Alt+click or
   click an untranslated sentence to translate its paragraph.
3. **PDF Bilingual: 翻译整篇** translates the whole paper (with confirmation,
   progress and cancel); **清除翻译缓存** removes cached translations.

Defaults: `baseUrl` `https://api.deepseek.com`, `model` `deepseek-flash`,
`temperature` 0.7, and `extraBody` `{"thinking": {"type": "disabled"}}` (DeepSeek
enables thinking mode by default). For a local Ollama, set `baseUrl` to
`http://localhost:11434/v1`, `extraBody` to `{}` and no key is needed.

API calls, cache hits and token usage are logged to the **PDF Bilingual** output
channel.

## Development

```sh
pnpm install
pnpm run build      # extension + webview bundles
pnpm test           # segmenter unit tests
pnpm run check      # typecheck, lint, format check
```

Press `F5` in VS Code to launch an Extension Development Host.

Without VS Code, the webview can be exercised in a browser:
`pnpm run harness`, then open `http://localhost:5178/?pdf=papers/<file>.pdf`.
Messages to the extension host are recorded in `window.__hostMessages`.

Evaluating the segmenter on a new paper:

```sh
pnpm run fixtures papers/<file>.pdf test/fixtures
pnpm run segment test/fixtures/<file>.p3.json            # one page, full output
pnpm run segment test/fixtures/<file>.p*.json --sample 50  # random sample
```

## Updating PDF.js

- update `pdfjs_version.txt` to target version and hash
- from root folder of this repo run `tools/prepare_pdfjs.sh`, this will download PDF.js in given version and try to apply patches from the `patches` folder to it
  - if the patches apply cleanly the command terminates and you are done
  - if the patches fail to apply, for every conflict a `*.rej` file will be generated in the `assets/pdf.js` folder,
    you need to resolve these manually and then delete the `.rej` files

To keep the current PDF.js version and add patches, run with the `--update-patches` flag. The script stops after applying the current patches so you can modify `assets/pdf.js`. When you finish, it creates a new patch from your changes.

The `prepare_pdfjs.sh` script does not create any commits in this repo, after you are happy with the patches you prepared be sure to commit everything manually.

## License

Apache-2.0. See `LICENSE` and `NOTICE`.
