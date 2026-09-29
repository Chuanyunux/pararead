# Contributing / 贡献指南

Issues and pull requests are welcome. 欢迎提交 Issue 和 Pull Request。

## Development / 开发

```sh
pnpm install
pnpm run build   # extension + webview bundles / 构建扩展与网页视图
pnpm test        # unit tests; the first run downloads a test paper from arXiv / 首次运行会从 arXiv 下载测试论文
pnpm run check   # typecheck, lint, format check / 类型检查、lint、格式检查
```

Press `F5` in VS Code to launch an Extension Development Host. The webview can
also be exercised in a browser with `pnpm run harness` (see README).

在 VS Code 中按 `F5` 启动扩展调试窗口；也可以用 `pnpm run harness` 在浏览器中调试网页视图（见 README）。

## Guidelines / 约定

- Run `pnpm run fix` before committing, and keep `pnpm run check` and
  `pnpm test` green. 提交前运行 `pnpm run fix`，并保证检查和测试通过。
- Do not commit papers or text extracted from them: most papers may not be
  redistributed. Test fixtures are generated into `.cache/`.
  不要提交论文或从论文提取的文本（多数论文不允许再分发），测试数据会生成到 `.cache/`。
- Changes to PDF.js go through `patches/` (see "Updating PDF.js" in the README).
  对 PDF.js 的修改请通过 `patches/` 补丁机制。

## Contributor License Agreement / 贡献者许可协议

Before a pull request can be merged, please sign the
[Contributor License Agreement](CLA.md). CLA Assistant asks you to do this with
one click on your first pull request. You keep the copyright in your
contribution; the CLA lets the project remain Apache-2.0 today and adjust its
licensing in the future without contacting every contributor.

首次提交 PR 时，CLA Assistant 机器人会请你一键签署 [贡献者许可协议](CLA.md)，签署后才能合并。你保留贡献内容的版权；协议让项目现在继续以 Apache-2.0 开源，将来调整许可时无需逐一联系每位贡献者。
