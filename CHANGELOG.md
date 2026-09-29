# Changelog

All notable changes to this project are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
follows [Semantic Versioning](https://semver.org/).

## [0.1.2] - 2026-09-29

### Changed

- The product name is ParaRead in every language; the Chinese alias was dropped.
- Contributions now require signing the Contributor License Agreement (CLA.md).

## [0.1.1] - 2026-09-28

Prepares the extension for the VS Code Marketplace and Open VSX.

### Changed

- Publisher is now `chuanyunux`, so the extension ID is `chuanyunux.pararead`.
  Settings are unchanged, but the API key has to be set again once and the
  translation cache starts empty.
- Marked as a preview release while the version is below 1.0.

## [0.1.0] - 2026-09-28

First public release of ParaRead. Based on [vscode-pdf](https://github.com/mathematic-inc/vscode-pdf)
0.2.5 (PDF.js 6.2.108).

### Added

- Sentence segmentation of the PDF text layer (two-column layouts, paragraphs
  interrupted by figures, hyphenation, abbreviations, citations, code listings).
- Translation panel typeset like the paper (headings, paragraphs, lists,
  captions, footnotes, code), with an option to show the original text.
- Hover or click a sentence to highlight it, point to its translation and keep
  both at the same height; scrolling the PDF scrolls the translation.
- Translation through any OpenAI-compatible API, DeepSeek by default; API key in
  VS Code secret storage; per-sentence disk cache; automatic translation of the
  pages being read, or of the whole document.
- Saving annotations made with the PDF.js editors back into the PDF.
