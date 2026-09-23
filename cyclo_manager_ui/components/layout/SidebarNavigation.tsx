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

"use client";

import Link from "next/link";
import type { CSSProperties, MouseEvent } from "react";
import { navigationItems } from "@/config/navigation";

export default function SidebarNavigation({ pathname, onNavigate, onSystem, onJog }: {
  pathname: string; onNavigate: () => void; onSystem: () => void; onJog: () => void;
}) {
  return <nav
    className="flex-1 min-h-0 w-full flex flex-col items-center gap-1.5 py-2 px-1 overflow-y-auto"
    style={{ scrollbarGutter: "stable" }}
  >
    {navigationItems.map(item => {
      const active = item.matches(pathname);
      const style: CSSProperties = {
        backgroundColor: active ? "var(--vscode-list-activeSelectionBackground)" : "transparent",
        color: active ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)",
      };
      const props = {
        className: "flex flex-col items-center justify-center gap-0.5 rounded-md w-full aspect-square shrink-0 px-1 py-1 text-center transition-colors box-border",
        onMouseEnter: (event: MouseEvent<HTMLElement>) => {
          if (!active) event.currentTarget.style.backgroundColor = "var(--vscode-list-hoverBackground)";
        },
        onMouseLeave: (event: MouseEvent<HTMLElement>) => {
          if (!active) event.currentTarget.style.backgroundColor = "transparent";
        },
      };
      const content = <>
        <span className="text-[1.125rem] leading-none select-none" aria-hidden>{item.icon}</span>
        <span className="text-[10px] font-semibold leading-tight">{item.label}</span>
      </>;
      return item.action ? (
        <button key={item.action} {...props} onClick={item.action === "system" ? onSystem : onJog}
          style={{ ...style, border: "none", cursor: "pointer" }}>{content}</button>
      ) : (
        <Link key={item.href} {...props} href={item.href} onClick={onNavigate}
          className={`${props.className} no-underline`} style={style}>{content}</Link>
      );
    })}
  </nav>;
}
