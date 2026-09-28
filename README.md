# PDF Bilingual Reader

A VS Code extension for reading English papers with sentence-level Chinese
translations, built on [vscode-pdf](https://github.com/mathematic-inc/vscode-pdf)
and [Mozilla PDF.js](https://mozilla.github.io/pdf.js/).

- Full PDF.js viewer, including the annotation editors (highlight, free text,
  ink, stamp). Annotations are saved back into the PDF with `Ctrl+S`.
- **Alt+click** a sentence in the PDF to highlight it and show its translation
  in the panel on the right; click a sentence in the panel to jump back.
- The panel can be resized with the splitter and toggled with the **译** button
  in the toolbar.

Status: milestone M1 — sentence segmentation and linking work; the panel shows
placeholder translations until the translation service lands (M2). See
`pdf-bilingual-reader-需求.md` for the full plan.

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
