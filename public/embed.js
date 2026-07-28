/**
 * Punaab website embed loader.
 *
 * Usage — one tag, anywhere in the page:
 *
 *   <script src="https://punaab.com/embed.js" data-punaab="pweb_xxxxx" async></script>
 *
 * Optional attributes:
 *   data-mode="corner"    corner (default) | inline
 *   data-target="#id"     required for inline; the element to mount into
 *   data-position="right" right (default) | left
 *   data-label="..."      text on the launcher button
 *
 * Everything renders inside an iframe. That is the whole design: a third-party
 * widget that injected React and WebGL straight into the host page would
 * inherit its CSS, fight its bundler, and expose the host's DOM to us. An
 * iframe means a broken Punaab can never break somebody's storefront.
 */
(function () {
  "use strict";

  var script =
    document.currentScript ||
    (function () {
      var all = document.getElementsByTagName("script");
      for (var i = all.length - 1; i >= 0; i--) {
        if (all[i].src && all[i].src.indexOf("embed.js") !== -1) return all[i];
      }
      return null;
    })();

  if (!script) return;

  var token = script.getAttribute("data-punaab");
  if (!token) {
    console.warn("[punaab] Missing data-punaab token on the embed script tag.");
    return;
  }

  // Derive the origin from where this script was served, so self-hosted and
  // staging deployments work without a second configuration knob.
  var origin = new URL(script.src, window.location.href).origin;
  var mode = script.getAttribute("data-mode") || "corner";
  var side = script.getAttribute("data-position") === "left" ? "left" : "right";
  var label = script.getAttribute("data-label") || "Talk to Punaab";
  var targetSelector = script.getAttribute("data-target");

  var SRC = origin + "/embed/" + encodeURIComponent(token);

  function buildFrame() {
    var frame = document.createElement("iframe");
    frame.src = SRC;
    frame.title = "Punaab";
    frame.setAttribute("loading", "lazy");
    // No same-origin: the frame is on our origin, and granting it same-origin
    // *and* scripts against the host would defeat the sandbox entirely.
    frame.setAttribute("allow", "autoplay");
    frame.style.border = "0";
    frame.style.width = "100%";
    frame.style.height = "100%";
    frame.style.colorScheme = "normal";
    return frame;
  }

  // --- Inline: mount into an element the page provides ---------------------
  if (mode === "inline") {
    var target = targetSelector && document.querySelector(targetSelector);
    if (!target) {
      console.warn(
        "[punaab] data-mode=\"inline\" needs a data-target selector that exists."
      );
      return;
    }
    var inlineFrame = buildFrame();
    inlineFrame.style.minHeight = "520px";
    target.appendChild(inlineFrame);
    return;
  }

  // --- Corner: a launcher button and a panel -------------------------------
  var host = document.createElement("div");
  host.setAttribute("data-punaab-widget", "");
  // A shadow root so the host page's CSS cannot restyle the launcher, and
  // ours cannot leak out and restyle theirs.
  var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;

  var style = document.createElement("style");
  style.textContent = [
    ":host, * { box-sizing: border-box; }",
    ".wrap {",
    "  position: fixed; bottom: 20px; " + side + ": 20px;",
    "  z-index: 2147483000;",
    "  font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;",
    "}",
    ".panel {",
    "  width: min(380px, calc(100vw - 40px));",
    "  height: min(560px, calc(100vh - 120px));",
    "  border-radius: 18px; overflow: hidden;",
    "  background: #f7efdc;",
    "  box-shadow: 0 18px 50px rgba(10, 14, 22, 0.35);",
    "  display: none; margin-bottom: 12px;",
    "  transform-origin: bottom " + side + ";",
    "  animation: pop 0.22s cubic-bezier(0.2, 0.9, 0.3, 1.2);",
    "}",
    ".panel.open { display: block; }",
    "@keyframes pop { from { opacity: 0; transform: translateY(12px) scale(0.96); } }",
    ".launch {",
    "  display: inline-flex; align-items: center; gap: 8px;",
    "  padding: 12px 18px; border-radius: 999px; cursor: pointer;",
    "  border: 2px solid #152238; background: #f5c451; color: #152238;",
    "  font-size: 15px; font-weight: 700; line-height: 1;",
    "  box-shadow: 0 6px 18px rgba(10, 14, 22, 0.28);",
    "  transition: transform 0.15s ease;",
    "}",
    ".launch:hover { transform: translateY(-2px); }",
    ".launch svg { width: 18px; height: 18px; }",
    "@media (prefers-reduced-motion: reduce) {",
    "  .panel { animation: none; } .launch { transition: none; }",
    "}",
  ].join("\n");

  var wrap = document.createElement("div");
  wrap.className = "wrap";

  var panel = document.createElement("div");
  panel.className = "panel";

  var button = document.createElement("button");
  button.className = "launch";
  button.type = "button";
  button.setAttribute("aria-expanded", "false");
  button.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/>' +
    '<circle cx="18" cy="16" r="3"/></svg>' +
    "<span></span>";
  button.querySelector("span").textContent = label;

  var loaded = false;
  button.addEventListener("click", function () {
    var open = panel.classList.toggle("open");
    button.setAttribute("aria-expanded", open ? "true" : "false");
    // The iframe is only created on first open, so a page carrying this tag
    // pays nothing until a visitor actually wants to talk to him.
    if (open && !loaded) {
      panel.appendChild(buildFrame());
      loaded = true;
    }
  });

  wrap.appendChild(panel);
  wrap.appendChild(button);
  root.appendChild(style);
  root.appendChild(wrap);

  function mount() {
    document.body.appendChild(host);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
})();
