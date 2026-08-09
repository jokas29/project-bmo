export type BrainRole = "system" | "user" | "assistant";

export interface BrainMessage {
  readonly role: BrainRole;
  readonly content: string;
}

export interface BrainClient {
  generateReply(messages: readonly BrainMessage[]): Promise<string>;
}

export type BrainClientErrorCode =
  | "unavailable"
  | "http-error"
  | "invalid-response";

export class BrainClientError extends Error {
  readonly code: BrainClientErrorCode;
  readonly status: number | undefined;

  constructor(
    code: BrainClientErrorCode,
    message: string,
    status?: number,
  ) {
    super(message);
    this.name = "BrainClientError";
    this.code = code;
    this.status = status;
  }
}
