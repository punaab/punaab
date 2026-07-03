import DOMPurify from "isomorphic-dompurify";
import { marked } from "marked";
import type { BotApp } from "./apps";

marked.setOptions({ gfm: true, breaks: true });

const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    "h1", "h2", "h3", "h4", "p", "br", "ul", "ol", "li",
    "strong", "em", "a", "code", "pre", "blockquote", "table",
    "thead", "tbody", "tr", "th", "td", "span", "div", "hr",
  ],
  ALLOWED_ATTR: ["href", "class", "target", "rel"],
};

export function renderMarkdown(content: string): string {
  const html = marked.parse(content, { async: false }) as string;
  return DOMPurify.sanitize(html, PURIFY_CONFIG);
}

export function renderHtml(content: string): string {
  return DOMPurify.sanitize(content, PURIFY_CONFIG);
}

export interface DashboardWidget {
  type: "stat" | "text" | "list";
  label: string;
  value?: string | number;
  items?: string[];
}

export interface DashboardConfig {
  title?: string;
  widgets: DashboardWidget[];
}

export function renderJsonDashboard(content: string): string {
  let config: DashboardConfig;
  try {
    config = JSON.parse(content) as DashboardConfig;
  } catch {
    return "<p>Invalid dashboard configuration.</p>";
  }

  const widgets = (config.widgets ?? [])
    .map((w) => {
      if (w.type === "stat") {
        return `<div class="widget stat"><span class="widget-label">${escapeHtml(w.label)}</span><span class="widget-value">${escapeHtml(String(w.value ?? ""))}</span></div>`;
      }
      if (w.type === "list" && w.items) {
        const items = w.items.map((i) => `<li>${escapeHtml(i)}</li>`).join("");
        return `<div class="widget list"><span class="widget-label">${escapeHtml(w.label)}</span><ul>${items}</ul></div>`;
      }
      return `<div class="widget text"><span class="widget-label">${escapeHtml(w.label)}</span><p>${escapeHtml(String(w.value ?? ""))}</p></div>`;
    })
    .join("");

  return DOMPurify.sanitize(
    `<div class="json-dashboard">${widgets}</div>`,
    PURIFY_CONFIG,
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderAppContent(app: BotApp): string {
  switch (app.kind) {
    case "markdown":
      return renderMarkdown(app.content);
    case "html":
      return renderHtml(app.content);
    case "json-dashboard":
      return renderJsonDashboard(app.content);
    default:
      return "<p>Unsupported app type.</p>";
  }
}
