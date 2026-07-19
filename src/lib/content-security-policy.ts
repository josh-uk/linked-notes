export function buildContentSecurityPolicy(
  nonce: string,
  development = process.env.NODE_ENV === "development",
) {
  if (!/^[A-Za-z0-9+/=_-]+$/.test(nonce)) {
    throw new Error("Content Security Policy nonce was invalid");
  }

  const directives = [
    "default-src 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' ${development ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    // Tiptap positioning and the theme switcher set bounded inline style
    // properties at runtime; style elements remain nonce-only in production.
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self'${development ? " ws: wss:" : ""}`,
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ];
  return `${directives.join("; ")};`;
}
