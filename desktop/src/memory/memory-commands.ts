export const REMEMBER_COMMAND_PREFIX = "recuerda que ";

export interface RememberMemoryCommand {
  readonly kind: "remember";
  readonly text: string;
}

/**
 * Recognizes only the explicit, anchored `recuerda que ` command.
 * Leading whitespace and letter casing are ignored; normal messages are not
 * interpreted as memories.
 */
export function parseMemoryCommand(
  input: string,
): RememberMemoryCommand | undefined {
  const match = /^\s*recuerda que ([\s\S]*)$/iu.exec(input);

  if (match === null) {
    return undefined;
  }

  return {
    kind: "remember",
    text: match[1].trim(),
  };
}
