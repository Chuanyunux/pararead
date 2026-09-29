/**
 * User-facing translation errors, identified by a code so that the extension
 * host can show them in the VS Code display language. The English templates
 * double as `vscode.l10n` keys; `{0}`, `{1}` are replaced by the arguments.
 */

export const ERROR_MESSAGES = {
  badRequest: "Invalid request (400). Check the model and extraBody settings.",
  unauthorized: "Invalid API key (401). Set the API key again.",
  insufficientBalance: "Insufficient account balance (402). Top up and try again.",
  notFound: "API URL or model not found (404). Check the baseUrl and model settings.",
  invalidParams: "Invalid request parameters (422). Check the model and extraBody settings.",
  timeout: "Request timed out ({0} s).",
  network: "Network error: {0}",
  http: "The translation API returned error {0}: {1}",
  noTranslation: "The model returned no valid translation.",
  cancelled: "Cancelled.",
  noApiKey: "The API key is not set.",
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;
export type MessageArg = string | number;

export function formatMessage(template: string, args: readonly MessageArg[]): string {
  return template.replaceAll(/\{(\d+)\}/gu, (match, index: string) => {
    const value = args[Number(index)];
    return value === undefined ? match : String(value);
  });
}

export class TranslationError extends Error {
  readonly code: ErrorCode;
  readonly args: readonly MessageArg[];

  constructor(code: ErrorCode, args: readonly MessageArg[] = []) {
    super(formatMessage(ERROR_MESSAGES[code], args));
    this.name = "TranslationError";
    this.code = code;
    this.args = args;
  }
}

/** Error code and arguments of a failure, for localization. */
export function errorDetails(error: unknown): {
  message: string;
  code?: ErrorCode;
  args?: readonly MessageArg[];
} {
  if (error instanceof TranslationError) {
    return { message: error.message, code: error.code, args: error.args };
  }
  return { message: error instanceof Error ? error.message : String(error) };
}
