// Minimal Markdown subset for the bundled docs: headings, paragraphs, lists, fenced code, tables, quotes,
// code spans, bold, italic and http(s) links. The output is a plain node tree; raw HTML is never interpreted,
// so rendering it with React elements cannot inject markup or scripts.

const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const FENCE = /^\s*```\s*([\w+-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const ESCAPABLE = '\\`*[]()#+-.!|<>_{}~';

export function safeHref(value) {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function findClosing(text, marker, from) {
  for (let index = from; index < text.length; index += 1) {
    if (text[index] === '\\') index += 1;
    else if (text.startsWith(marker, index)) return index;
  }
  return -1;
}

function matchingBracket(text, start) {
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === '\\') index += 1;
    else if (text[index] === '[') depth += 1;
    else if (text[index] === ']' && --depth === 0) return index;
  }
  return -1;
}

function parseLink(text, start) {
  const close = matchingBracket(text, start);
  if (close < 0 || text[close + 1] !== '(') return null;
  let depth = 0;
  for (let index = close + 1; index < text.length; index += 1) {
    if (text[index] === '(') depth += 1;
    else if (text[index] === ')' && --depth === 0) {
      const destination = text
        .slice(close + 2, index)
        .trim()
        .split(/\s+/)[0]
        .replace(/^<|>$/g, '');
      return { label: text.slice(start + 1, close), href: safeHref(destination), end: index + 1 };
    }
  }
  return null;
}

export function parseInline(text) {
  const nodes = [];
  let buffer = '';
  const flush = () => {
    if (buffer) nodes.push({ type: 'text', text: buffer });
    buffer = '';
  };
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === '\\' && index + 1 < text.length && ESCAPABLE.includes(text[index + 1])) {
      buffer += text[index + 1];
      index += 2;
    } else if (char === '`') {
      let fence = 1;
      while (text[index + fence] === '`') fence += 1;
      const marker = '`'.repeat(fence);
      const end = text.indexOf(marker, index + fence);
      if (end < 0) {
        buffer += marker;
        index += fence;
      } else {
        flush();
        const code = text.slice(index + fence, end);
        nodes.push({ type: 'code', text: code.length > 2 && /^ .* $/.test(code) ? code.slice(1, -1) : code });
        index = end + fence;
      }
    } else if (char === '*') {
      const marker = text.startsWith('**', index) ? '**' : '*';
      const end = /\s/.test(text[index + marker.length] ?? ' ') ? -1 : findClosing(text, marker, index + marker.length);
      if (end < 0 || /\s/.test(text[end - 1])) {
        buffer += marker;
        index += marker.length;
      } else {
        flush();
        const children = parseInline(text.slice(index + marker.length, end));
        nodes.push({ type: marker === '**' ? 'strong' : 'em', children });
        index = end + marker.length;
      }
    } else if (char === '[') {
      const link = parseLink(text, index);
      if (!link) {
        buffer += char;
        index += 1;
      } else {
        flush();
        const children = parseInline(link.label);
        // Unsafe or relative destinations keep the label as plain text.
        if (link.href) nodes.push({ type: 'link', href: link.href, children });
        else nodes.push(...children);
        index = link.end;
      }
    } else {
      buffer += char;
      index += 1;
    }
  }
  flush();
  return nodes;
}

function splitRow(line) {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);
  const cells = [];
  let cell = '';
  for (let index = 0; index < row.length; index += 1) {
    if (row[index] === '\\' && row[index + 1] === '|') {
      cell += '|';
      index += 1;
    } else if (row[index] === '|') {
      cells.push(cell.trim());
      cell = '';
    } else cell += row[index];
  }
  cells.push(cell.trim());
  return cells;
}

function alignment(cell) {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  if (left && right) return 'center';
  return right ? 'right' : left ? 'left' : null;
}

const isTableStart = (line, next) =>
  line.includes('|') &&
  next !== undefined &&
  TABLE_DELIMITER.test(next) &&
  splitRow(line).length === splitRow(next).length;

const startsBlock = (line, next) =>
  FENCE.test(line) ||
  HEADING.test(line) ||
  RULE.test(line) ||
  LIST_ITEM.test(line) ||
  /^\s*>/.test(line) ||
  isTableStart(line, next);

export function parseMarkdown(source) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const next = lines[index + 1];
    const fence = FENCE.exec(line);
    const heading = HEADING.exec(line);
    if (!line.trim()) {
      index += 1;
    } else if (fence) {
      const body = [];
      index += 1;
      while (index < lines.length && !FENCE.test(lines[index])) body.push(lines[index++]);
      index += 1;
      blocks.push({ type: 'code', language: fence[1], text: body.join('\n') });
    } else if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, children: parseInline(heading[2]) });
      index += 1;
    } else if (RULE.test(line) && !LIST_ITEM.test(line)) {
      blocks.push({ type: 'rule' });
      index += 1;
    } else if (isTableStart(line, next)) {
      const header = splitRow(line);
      const aligns = splitRow(next).map(alignment);
      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].trim() && lines[index].includes('|')) {
        rows.push(splitRow(lines[index++]));
      }
      const cell = (text, column) => ({ align: aligns[column] ?? null, children: parseInline(text ?? '') });
      blocks.push({
        type: 'table',
        header: header.map(cell),
        rows: rows.map((row) => header.map((_, column) => cell(row[column], column))),
      });
    } else if (/^\s*>/.test(line)) {
      const quoted = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) quoted.push(lines[index++].replace(/^\s*> ?/, ''));
      blocks.push({ type: 'quote', children: parseMarkdown(quoted.join('\n')) });
    } else if (LIST_ITEM.test(line)) {
      const ordered = /\d/.test(LIST_ITEM.exec(line)[2]);
      const items = [];
      while (index < lines.length) {
        const match = LIST_ITEM.exec(lines[index]);
        if (match) {
          items.push(match[3]);
          index += 1;
        } else if (lines[index].trim() && /^\s+/.test(lines[index]) && items.length) {
          items[items.length - 1] += ` ${lines[index].trim()}`;
          index += 1;
        } else break;
      }
      blocks.push({ type: 'list', ordered, items: items.map(parseInline) });
    } else {
      const paragraph = [line.trim()];
      index += 1;
      while (index < lines.length && lines[index].trim() && !startsBlock(lines[index], lines[index + 1])) {
        paragraph.push(lines[index++].trim());
      }
      blocks.push({ type: 'paragraph', children: parseInline(paragraph.join(' ')) });
    }
  }
  return blocks;
}
