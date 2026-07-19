import { isSafeLink } from "./document-schema";

const unsafeElements =
  "script,style,iframe,object,embed,form,input,button,svg,math,meta,link";

export function sanitizePastedHtml(html: string): string {
  if (typeof DOMParser === "undefined") return html;

  const document = new DOMParser().parseFromString(html, "text/html");
  if (document.body.querySelector(unsafeElements)) {
    return escapeHtml(document.body.textContent ?? "");
  }

  for (const element of document.body.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) {
      if (
        attribute.name.toLowerCase().startsWith("on") ||
        attribute.name === "style"
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  }

  for (const anchor of document.body.querySelectorAll("a[href]")) {
    const href = anchor.getAttribute("href");
    if (!href || !isSafeLink(href)) anchor.removeAttribute("href");
  }

  return document.body.innerHTML;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
