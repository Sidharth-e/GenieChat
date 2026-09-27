export interface ParsedSseChunk {
  events: string[];
  remainder: string;
}

export function parseSseChunk(
  buffer: string,
  chunk: string,
): ParsedSseChunk {
  const normalized = `${buffer}${chunk}`.replace(/\r\n/g, "\n");
  const frames = normalized.split("\n\n");
  const remainder = frames.pop() ?? "";
  const events: string[] = [];

  for (const frame of frames) {
    if (!frame.trim()) {
      continue;
    }

    const dataLines = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart());

    if (dataLines.length > 0) {
      events.push(dataLines.join("\n"));
    }
  }

  return { events, remainder };
}
