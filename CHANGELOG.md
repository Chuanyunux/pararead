# Changelog

All notable changes to this project are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
follows [Semantic Versioning](https://semver.org/).

## [0.4.0] - 2026-09-29

### Added

- Papers in any of the 11 supported languages, not only English. The language
  of each sentence is detected automatically; `pararead.sourceLanguage` sets it
  explicitly when detection fails.
- Chinese and Japanese papers are split at full-width punctuation, and their
  lines are joined without spaces. Headings, lists and captions are recognized
  in these languages too (e.g. `第3章`, `一、`, `图 1`, `表 2`).
- Common German, French, Spanish, Portuguese, Italian and Russian
  abbreviations (`z. B.`, `p. ex.`, `см.`) no longer end a sentence.
- Simplified and Traditional Chinese are told apart, so a Traditional Chinese
  paper can be read in Simplified Chinese and vice versa.

### Changed

- The translation prompt names the detected source language of each request.

## [0.3.0] - 2026-09-29

### Added

- The interface follows the VS Code display language: English by default, and
  Chinese for a Chinese VS Code. This covers commands, settings, dialogs,
  notifications, error messages and the translation panel.

### Changed

- The toolbar button of the translation panel is now an icon.
- The output channel log is in English.

## [0.2.0] - 2026-09-29

### Added

- Translation into 11 languages: Simplified and Traditional Chinese, English,
  Japanese, Korean, French, German, Spanish, Portuguese, Russian and Italian
  (`pararead.targetLanguage`). The default `auto` follows the VS Code display
  language and falls back to English. Changing it re-translates open papers.
- Per-language glossary sections, e.g. `{"ja": {"attention": "アテンション"}}`,
  which take precedence over general entries.
- Sentences already written in the target language are shown as they are,
  without an API call.

### Changed

- The translation panel adapts to the target language: spaces between
  sentences, and first-line indentation only for Chinese and Japanese.
- The translation prompt is language-neutral. Existing Chinese translations in
  the cache remain valid.

### Fixed

- Changing settings sent the previous values to open viewers.

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
