/** Server-sent events (ADR 9), parsed from a streamed body. */

export interface Message {
  readonly name: string;
  readonly data: string;
}

/** Server-sent events from a body's bytes; comments and keep-alives yield nothing. */
export function events(): TransformStream<Uint8Array, Message> {
  const decoder = new TextDecoder();
  let buffer = "";

  return new TransformStream({
    transform: (chunk, controller) => {
      buffer += decoder.decode(chunk, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";

      for (const block of blocks) {
        const parsed = message(block);

        if (parsed.data !== "") controller.enqueue(parsed);
      }
    },
  });
}

function message(block: string): Message {
  const fields = block.split("\n").map((line) => {
    const colon = line.indexOf(":");

    return [line.slice(0, colon), line.slice(colon + 1).trimStart()] as const;
  });

  return {
    name: fields.find(([field]) => field === "event")?.[1] ?? "message",
    data: fields
      .filter(([field]) => field === "data")
      .map(([, value]) => value)
      .join("\n"),
  };
}
