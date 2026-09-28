/*
 * Copyright 2021 Mathematic Inc
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Modified by chuanyun, 2026: removed the upstream sponsorship prompt;
 * translation service and commands.
 */

import { commands, type ExtensionContext, window } from "vscode";

import { PDFViewerProvider } from "./pdf-viewer-provider";
import { TranslationBridge } from "./translation-bridge";
import { SET_API_KEY_COMMAND, TranslationService } from "./translation/service";

const NO_VIEWER = "请先在 ParaRead 中打开一个 PDF。";

export function activate(context: ExtensionContext): void {
  const translation = new TranslationService(context);
  const bridge = new TranslationBridge(translation);
  const provider = new PDFViewerProvider(context, translation, bridge);

  context.subscriptions.push(
    translation,
    PDFViewerProvider.register(provider),
    commands.registerCommand(SET_API_KEY_COMMAND, () => translation.setApiKey()),
    commands.registerCommand("pararead.clearCache", () => translation.clearCache()),
    commands.registerCommand("pararead.translatePage", () => {
      if (!provider.postToActive({ type: "translateCurrentPage" })) {
        void window.showInformationMessage(NO_VIEWER);
      }
    }),
    commands.registerCommand("pararead.translateDocument", () => {
      const webview = provider.activeWebview();
      if (webview === undefined) {
        void window.showInformationMessage(NO_VIEWER);
        return;
      }
      return bridge.translateDocument(webview);
    }),
  );
}

export function deactivate() {
  // noop
}
