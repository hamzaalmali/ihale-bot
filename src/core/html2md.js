// HTML → Markdown conversion, substitute for Python MarkItDown.
let turndown = null;

function getConverter() {
  if (turndown) return turndown;
  const TurndownService = require('turndown');
  turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '_',
  });
  // Preserve line breaks inside paragraphs
  turndown.addRule('lineBreak', {
    filter: 'br',
    replacement: () => '\n',
  });
  return turndown;
}

function htmlToMarkdown(html) {
  if (!html || typeof html !== 'string') return null;
  try {
    return getConverter().turndown(html);
  } catch (err) {
    return null;
  }
}

function textPreview(html, maxLength = 200) {
  if (!html) return '';
  const text = String(html)
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > maxLength ? text.slice(0, maxLength) + '…' : text;
}

module.exports = { htmlToMarkdown, textPreview };
