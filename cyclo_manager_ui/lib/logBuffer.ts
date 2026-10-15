// Copyright 2026 ROBOTIS CO., LTD.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Author: Hyungyu Kim

const BLOCK_LINES = 1000;
export const MAX_LOG_LINES = 5000;
export const MAX_LOG_CHARS = 4 * 1024 * 1024;

export type LogBlock = {
  // Fixed line-number buckets keep React keys stable when older lines are trimmed.
  id: number;
  firstLine: number;
  lines: readonly string[];
  charCount: number;
};

function createBlocks(lines: readonly string[], firstLine: number): LogBlock[] {
  const blocks: LogBlock[] = [];
  for (let offset = 0; offset < lines.length;) {
    const id = Math.floor(firstLine / BLOCK_LINES);
    const size = Math.min(lines.length - offset, (id + 1) * BLOCK_LINES - firstLine);
    const part = lines.slice(offset, offset + size);
    blocks.push({ id, firstLine, lines: part,
      charCount: part.reduce((total, line) => total + line.length, part.length - 1) });
    offset += size;
    firstLine += size;
  }
  return blocks;
}

export function appendLogBlocks(blocks: readonly LogBlock[], text: string): LogBlock[] {
  if (!text) return blocks.slice();
  const parts = text.split("\n");
  const last = blocks[blocks.length - 1];
  if (!last) return createBlocks(parts, 0);
  // Preserve the trailing empty line after a newline and join partial lines/ANSI sequences.
  const lines = last.lines.slice(0, -1).concat(last.lines[last.lines.length - 1] + parts[0], parts.slice(1));
  return blocks.slice(0, -1).concat(createBlocks(lines, last.firstLine));
}

// Remove a decoded prefix without rebuilding untouched blocks.
// Whole blocks can be skipped; only the remaining first block needs to be copied.
function trimLogBlocks(blocks: readonly LogBlock[], chars: number): LogBlock[] {
  if (!chars || !blocks.length) return blocks.slice();
  let index = 0;
  while (index < blocks.length - 1 && chars >= blocks[index].charCount + 1) {
    chars -= blocks[index].charCount + 1; // Include the newline between blocks.
    index++;
  }
  const first = blocks[index];
  if (!chars) return blocks.slice(index);
  let removedLines = 0;
  while (removedLines < first.lines.length - 1 && chars >= first.lines[removedLines].length + 1) {
    chars -= first.lines[removedLines].length + 1;
    removedLines++;
  }
  const lines = first.lines.slice(removedLines);
  lines[0] = lines[0].slice(chars);
  return createBlocks(lines, first.firstLine + removedLines).concat(blocks.slice(index + 1));
}

function getLogLineCount(blocks: readonly LogBlock[]): number {
  const last = blocks[blocks.length - 1];
  if (!last) return 0;
  const trailingEmpty = last.lines[last.lines.length - 1] === "" ? 1 : 0;
  return last.firstLine + last.lines.length - blocks[0].firstLine - trailingEmpty;
}

export function limitLogBlocks(blocks: LogBlock[], charCount: number) {
  let excessLines = Math.max(0, getLogLineCount(blocks) - MAX_LOG_LINES);
  const excessChars = Math.max(0, charCount - MAX_LOG_CHARS);
  let removedChars = 0;
  const last = blocks[blocks.length - 1];
  for (const block of blocks) {
    if (excessLines <= 0 && removedChars >= excessChars) break;
    if (block !== last && (excessLines >= block.lines.length ||
      removedChars + block.charCount + 1 <= excessChars)) {
      removedChars += block.charCount + 1;
      excessLines -= block.lines.length;
      continue;
    }
    // Prefer whole lines so character limits do not split ANSI escapes or emoji.
    const completeLines = block.lines.length - (block === last ? 1 : 0);
    for (let i = 0; i < completeLines; i++) {
      if (excessLines <= 0 && removedChars >= excessChars) break;
      removedChars += block.lines[i].length + 1;
      excessLines--;
    }
  }
  // Only a single unfinished line longer than the character cap needs a partial cut.
  removedChars = Math.max(removedChars, excessChars);
  if (!removedChars) return { blocks, charCount };
  let retained = trimLogBlocks(blocks, removedChars);
  // A character-count cut must not leave half an emoji at the start of the view.
  const firstCode = retained[0].lines[0].charCodeAt(0);
  if (firstCode >= 0xdc00 && firstCode <= 0xdfff) {
    retained = trimLogBlocks(retained, 1);
    removedChars++;
  }
  return { blocks: retained, charCount: charCount - removedChars };
}
