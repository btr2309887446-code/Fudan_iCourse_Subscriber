/**
 * Markdown + KaTeX rendering pipeline.
 * Sets window.ICS.render global.
 *
 * Depends on CDN globals: marked, DOMPurify, renderMathInElement
 *
 * Pipeline: stash formulas → marked → restore formulas → DOMPurify → KaTeX
 * We stash formula delimiters before marked.parse() because characters like
 * * and _ inside $...$ LaTeX (e.g. D^*, P_n, \sum_{i=1}) would otherwise
 * be treated as markdown emphasis and break the formula structure.
 */

window.ICS = window.ICS || {};

var _FORMULA_PLACEHOLDER_PREFIX = "";
var _FORMULA_PLACEHOLDER_SUFFIX = "";

/** Replace $...$ and $$...$$ with placeholders so marked won't touch them. */
function _stashFormulas(mdText) {
  var formulas = [];
  function stash(replacement) {
    var key = _FORMULA_PLACEHOLDER_PREFIX + formulas.length + _FORMULA_PLACEHOLDER_SUFFIX;
    formulas.push(replacement);
    return key;
  }

  var text = mdText;

  // 1. Stash existing \(...\) and \[...\] (already-LaTeX, protect from double-processing)
  text = text.replace(/(\\\([\s\S]*?\\\))|(\\\[[\s\S]*?\\\])/g, function (m) {
    return stash(m);
  });

  // 2. Stash $$...$$ (must run before $ → to avoid consuming individual $ chars of $$)
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, function (_, f) {
    return stash("\\[" + f + "\\]");
  });

  // 3. Stash $...$ (inline math — non-greedy to pair nearest closing $)
  text = text.replace(/\$([\s\S]+?)\$/g, function (_, f) {
    return stash("\\(" + f + "\\)");
  });

  return { text: text, formulas: formulas };
}

/** Restore stashed formulas in the HTML output after marked.parse(). */
function _restoreFormulas(html, formulas) {
  for (var i = 0; i < formulas.length; i++) {
    html = html.split(_FORMULA_PLACEHOLDER_PREFIX + i + _FORMULA_PLACEHOLDER_SUFFIX).join(formulas[i]);
  }
  return html;
}

function _renderMarkdown(mdText) {
  if (!mdText) return "";
  var stashed = _stashFormulas(mdText);
  var rawHtml = marked.parse(stashed.text, { breaks: true });
  var restored = _restoreFormulas(rawHtml, stashed.formulas);
  return DOMPurify.sanitize(restored);
}

function _activateKaTeX(element) {
  if (typeof renderMathInElement !== "function") return;
  renderMathInElement(element, {
    delimiters: [
      { left: "$$", right: "$$", display: true },
      { left: "\\[", right: "\\]", display: true },
      { left: "\\(", right: "\\)", display: false },
      // NOTE: $...$ intentionally omitted from KaTeX — converted to \(...\) in _stashFormulas
    ],
    throwOnError: false,
  });
}

function _plainSnippet(mdText, maxLen) {
  maxLen = maxLen || 100;
  if (!mdText) return "";
  var text = mdText
    .replace(/\$\$.+?\$\$/gs, "...")
    .replace(/\\\[.+?\\\]/gs, "...")
    .replace(/\$[^$]+?\$/g, "...")
    .replace(/\\\(.+?\\\)/g, "...")
    .replace(/#{1,6}\s+/g, "")
    .replace(/\*{1,3}(.+?)\*{1,3}/g, "$1")
    .replace(/`{1,3}[^`]*`{1,3}/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[|:\-]+/g, " ")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
}

function _openPrintView(course, lectures) {
  // Open synchronously from the click so browsers do not block the preview.
  // Native printing keeps text selectable and uses the existing KaTeX renderer.
  const preview = window.open("", "_blank");
  if (!preview) throw new Error("浏览器拦截了打印预览，请允许本站打开新窗口后重试。");
  preview.opener = null;
  const doc = preview.document;
  doc.open();
  doc.write("<!DOCTYPE html><html lang='zh-CN'><head><meta charset='UTF-8'>" +
    "<meta name='viewport' content='width=device-width, initial-scale=1'></head><body>" +
    "<div class='print-toolbar'><button type='button' disabled>正在准备排版…</button>" +
    "<p role='status'>排版完成后，点击打印并选择“另存为 PDF”。</p></div>" +
    "<main class='prose'></main></body></html>");
  doc.close();
  doc.title = course.title || "课程摘要";

  const stylesReady = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
    .map((source) => new Promise((resolve) => {
      const link = doc.createElement("link");
      link.rel = "stylesheet";
      link.href = source.href;
      link.onload = () => resolve(true);
      link.onerror = () => resolve(false);
      doc.head.appendChild(link);
    }));
  const style = doc.createElement("style");
  style.textContent = `
    @page { size: A4; margin: 18mm 16mm; }
    body { margin: 0; background: #fff; color: #1a1a1a;
      font-family: "Microsoft YaHei", "PingFang SC", sans-serif; }
    main { max-width: 180mm; margin: 24px auto; padding: 0 16px; }
    h1 { font-size: 26px; } h2 { font-size: 21px; margin-top: 1.6em; }
    h1, h2, h3, h4 { break-after: avoid; }
    p { orphans: 3; widows: 3; }
    img, svg { max-width: 100%; height: auto; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; }
    .prose .katex-display { overflow: visible; }
    .print-toolbar { padding: 16px; background: #eff6ff; text-align: center; }
    .print-toolbar button { padding: 10px 20px; cursor: pointer; }
    .print-toolbar p { margin: 8px 0 0; font-size: 14px; }
    @media print {
      .print-toolbar { display: none !important; }
      main { max-width: none; margin: 0; padding: 0; }
      .prose { font-size: 11pt; }
      .prose pre { overflow: visible; }
      tr, img, .katex-display { break-inside: avoid; }
      thead { display: table-header-group; }
    }
  `;
  doc.head.appendChild(style);

  const main = doc.querySelector("main");
  function appendText(parent, tag, text) {
    const node = doc.createElement(tag);
    node.textContent = text;
    parent.appendChild(node);
  }
  appendText(main, "h1", course.title || "课程摘要");
  if (course.teacher) appendText(main, "p", "任课教师：" + course.teacher);
  for (const lecture of lectures) {
    const section = doc.createElement("section");
    appendText(section, "h2", lecture.sub_title || "课程摘要");
    if (lecture.date) appendText(section, "p", lecture.date);
    const summary = doc.createElement("div");
    summary.innerHTML = _renderMarkdown(lecture.summary);
    _activateKaTeX(summary);
    section.appendChild(summary);
    main.appendChild(section);
  }

  const button = doc.querySelector("button");
  const status = doc.querySelector('[role="status"]');
  button.onclick = () => { preview.focus(); preview.print(); };
  const imagesReady = Array.from(main.querySelectorAll("img")).map((img) =>
    img.complete ? Promise.resolve(img.naturalWidth > 0) : new Promise((resolve) => {
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
    }));
  const ready = Promise.all(stylesReady).then(async (loaded) => {
    const imageResults = await Promise.all(imagesReady);
    await doc.fonts.ready;
    return loaded.every(Boolean) && imageResults.every(Boolean);
  });
  // A failed or blocked remote resource must not leave printing disabled.
  const timeout = setTimeout(() => enablePrint(false), 15000);
  function enablePrint(complete) {
    clearTimeout(timeout);
    if (preview.closed) return;
    button.disabled = false;
    button.textContent = "打印 / 另存为 PDF";
    status.textContent = complete
      ? "排版已完成。点击打印，在目标打印机中选择“另存为 PDF”。"
      : "部分字体或图片未完成加载，请检查预览后打印；也可稍后重新打开预览。";
  }
  ready.then(enablePrint, () => enablePrint(false));
  return preview;
}

window.ICS.render = {
  renderMarkdown: _renderMarkdown,
  activateKaTeX: _activateKaTeX,
  plainSnippet: _plainSnippet,
  openPrintView: _openPrintView,
};
