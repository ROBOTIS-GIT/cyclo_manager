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

export type DiffRowKind = "same" | "added" | "removed" | "changed";

export type DiffRow = {
  key: string;
  kind: DiffRowKind;
  leftLine: number | null;
  rightLine: number | null;
  leftText: string;
  rightText: string;
};

type DiffOp = {
  type: "same" | "added" | "removed";
  text: string;
  leftLine: number | null;
  rightLine: number | null;
};

function splitDiffLines(value: string): string[] {
  if (value === "") return [];
  const lines = value.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function simpleLineDiff(left: string[], right: string[]): DiffRow[] {
  const rowCount = Math.max(left.length, right.length);
  return Array.from({ length: rowCount }, (_, index) => {
    const hasLeft = index < left.length;
    const hasRight = index < right.length;
    const leftText = hasLeft ? left[index] : "";
    const rightText = hasRight ? right[index] : "";
    const same = hasLeft && hasRight && leftText === rightText;
    return {
      key: `simple-${index}`,
      kind: same ? "same" : hasLeft && hasRight ? "changed" : hasLeft ? "removed" : "added",
      leftLine: hasLeft ? index + 1 : null,
      rightLine: hasRight ? index + 1 : null,
      leftText,
      rightText,
    };
  });
}

function flushDiffRows(rows: DiffRow[], removed: DiffOp[], added: DiffOp[]) {
  const rowCount = Math.max(removed.length, added.length);
  for (let index = 0; index < rowCount; index += 1) {
    const left = removed[index];
    const right = added[index];
    rows.push({
      key: `diff-${rows.length}`,
      kind: left && right ? "changed" : left ? "removed" : "added",
      leftLine: left?.leftLine ?? null,
      rightLine: right?.rightLine ?? null,
      leftText: left?.text ?? "",
      rightText: right?.text ?? "",
    });
  }
}

export function buildSideBySideDiff(originalContent: string, currentContent: string): DiffRow[] {
  const left = splitDiffLines(originalContent);
  const right = splitDiffLines(currentContent);
  if (left.length * right.length > 400000) return simpleLineDiff(left, right);

  const dp = Array.from({ length: left.length + 1 }, () => new Uint32Array(right.length + 1));
  for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex -= 1) {
      dp[leftIndex][rightIndex] = left[leftIndex] === right[rightIndex]
        ? dp[leftIndex + 1][rightIndex + 1] + 1
        : Math.max(dp[leftIndex + 1][rightIndex], dp[leftIndex][rightIndex + 1]);
    }
  }

  const ops: DiffOp[] = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length || rightIndex < right.length) {
    if (leftIndex < left.length && rightIndex < right.length && left[leftIndex] === right[rightIndex]) {
      ops.push({ type: "same", text: left[leftIndex], leftLine: leftIndex + 1, rightLine: rightIndex + 1 });
      leftIndex += 1;
      rightIndex += 1;
    } else if (rightIndex >= right.length || (leftIndex < left.length && dp[leftIndex + 1][rightIndex] >= dp[leftIndex][rightIndex + 1])) {
      ops.push({ type: "removed", text: left[leftIndex], leftLine: leftIndex + 1, rightLine: null });
      leftIndex += 1;
    } else {
      ops.push({ type: "added", text: right[rightIndex], leftLine: null, rightLine: rightIndex + 1 });
      rightIndex += 1;
    }
  }

  const rows: DiffRow[] = [];
  let pendingRemoved: DiffOp[] = [];
  let pendingAdded: DiffOp[] = [];
  for (const op of ops) {
    if (op.type === "same") {
      flushDiffRows(rows, pendingRemoved, pendingAdded);
      pendingRemoved = [];
      pendingAdded = [];
      rows.push({
        key: `same-${rows.length}`,
        kind: "same",
        leftLine: op.leftLine,
        rightLine: op.rightLine,
        leftText: op.text,
        rightText: op.text,
      });
    } else if (op.type === "removed") {
      pendingRemoved.push(op);
    } else {
      pendingAdded.push(op);
    }
  }
  flushDiffRows(rows, pendingRemoved, pendingAdded);
  return rows;
}
