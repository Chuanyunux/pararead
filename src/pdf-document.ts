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
 * Modified by chuanyun, 2026: track unsaved annotation edits, backups, and
 * ignore file-watcher events caused by our own saves.
 */

import { createHash } from "node:crypto";

import { type CustomDocument, EventEmitter, type Uri, workspace } from "vscode";

import { Disposable } from "./disposable";

function areUriEqual(l: Uri, r: Uri) {
  return `${l}` === `${r}`;
}

function sha1(data: Uint8Array): string {
  return createHash("sha1").update(data).digest("hex");
}

/**
 * The document model for PDF files. The PDF bytes themselves live in the
 * webview (pdf.js); the host only tracks the dirty state and writes files.
 */
export class PDFDocument extends Disposable implements CustomDocument {
  private readonly _uri: Uri;
  private readonly _backupUri: Uri | undefined;
  private _dirty = false;
  /** Hash of the bytes we last wrote, to ignore the resulting watcher event. */
  private _lastWrittenHash: string | undefined;

  constructor(uri: Uri, backupUri?: Uri) {
    super();
    this._uri = uri;
    this._backupUri = backupUri;
    this._dirty = backupUri !== undefined;

    const watcher = this._register(workspace.createFileSystemWatcher(uri.fsPath));

    const onChangeHandler = async (e: Uri) => {
      if (!areUriEqual(e, uri) || (await this.isOwnWrite())) {
        return;
      }
      this._onDidChange.fire(e);
    };

    this._register(watcher.onDidChange(onChangeHandler));
    this._register(watcher.onDidCreate(onChangeHandler));
  }

  get uri() {
    return this._uri;
  }

  /** Where the webview loads the document from: a hot-exit backup if one exists. */
  get dataUri() {
    return this._backupUri ?? this._uri;
  }

  get isDirty() {
    return this._dirty;
  }

  /** Marks the document as having unsaved annotation edits. */
  markDirty() {
    if (this._dirty) {
      return;
    }
    this._dirty = true;
    this._onDidChangeContent.fire();
  }

  async write(target: Uri, data: Uint8Array) {
    if (areUriEqual(target, this._uri)) {
      this._lastWrittenHash = sha1(data);
    }
    await workspace.fs.writeFile(target, data);
  }

  markSaved() {
    this._dirty = false;
  }

  private async isOwnWrite(): Promise<boolean> {
    if (this._lastWrittenHash === undefined) {
      return false;
    }
    try {
      return sha1(await workspace.fs.readFile(this._uri)) === this._lastWrittenHash;
    } catch {
      return false;
    }
  }

  private readonly _onDidDelete = this._register(new EventEmitter<Uri>());
  /**
   * Fired when the document is deleted.
   */
  readonly onDidDelete = this._onDidDelete.event;

  private readonly _onDidChange = this._register(new EventEmitter<Uri>());
  /**
   * Fired to notify webviews that the document has changed on disk.
   */
  readonly onDidChange = this._onDidChange.event;

  private readonly _onDidChangeContent = this._register(new EventEmitter<void>());
  /**
   * Fired when the document gets unsaved edits.
   */
  readonly onDidChangeContent = this._onDidChangeContent.event;

  /**
   * Called by VS Code when there are no more references to the document.
   *
   * This happens when all editors for it have been closed.
   */
  override dispose(): void {
    this._onDidDelete.fire(this.uri);
    super.dispose();
  }
}
