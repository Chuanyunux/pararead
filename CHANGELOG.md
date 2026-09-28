# Changelog

All notable changes to this project are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
follows [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-09-28

First public release of ParaRead (并读). Based on [vscode-pdf](https://github.com/mathematic-inc/vscode-pdf)
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
