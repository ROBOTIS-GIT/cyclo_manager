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

import type { CSSProperties } from "react";

export const surface: CSSProperties = { background: "var(--vscode-sidebar-background)", borderColor: "var(--vscode-panel-border)" };
export const secondary: CSSProperties = { color: "var(--vscode-descriptionForeground)" };
export const button: CSSProperties = { background: "var(--vscode-button-secondaryBackground)", color: "var(--vscode-button-secondaryForeground)", borderColor: "var(--vscode-panel-border)" };
export const danger: CSSProperties = { color: "var(--vscode-errorForeground)", borderColor: "var(--vscode-errorForeground)" };
export const btn = "px-3 py-2 rounded border text-sm disabled:opacity-40 disabled:cursor-not-allowed";
