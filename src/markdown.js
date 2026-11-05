const esc = value =>
  String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));

function parseEmphasis(text) {
  let result = text.replace(/\*\*([^\n]+?)\*\*/g, (_, inner) => {
    return `<strong>${parseEmphasis(inner)}</strong>`;
  });
  result = result.replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, (_, inner) => {
    return `<em>${inner}</em>`;
  });
  return result;
}

function parseInline(raw) {
  if (!raw) return '';

  const codeSlots = [];
  let text = raw.replace(/`([^`\n]+?)`/g, (_, code) => {
    const idx = codeSlots.length;
    codeSlots.push(code);
    return `\x00CODE_${idx}\x00`;
  });

  text = esc(text);

  text = text.replace(/\[([^\]]*)\]\(([^)]*)\)/g, (fullMatch, linkText, href) => {
    const trimmedHref = href.trim();
    if (
      !/^https?:\/\//i.test(trimmedHref) ||
      /\s/.test(trimmedHref) ||
      /["']|&(?:quot|#39|#x27|apos);/i.test(trimmedHref) ||
      /[<>]|&(?:lt|gt);/i.test(trimmedHref)
    ) {
      return fullMatch;
    }
    const inner = parseEmphasis(linkText);
    return `<a href="${trimmedHref}">${inner}</a>`;
  });

  // 强调解析不得改写已生成的 <a> 标签内部：href 可能含 *（如
  // https://example.com/a**b**c），若直接全量跑强调，href 会被
  // <strong>/<em> 切断。先把整段锚点抽为占位，强调跑完再还原；
  // 占位内不含 *，故强调包裹链接（如 *a [b](...) c*）的行为不变。
  const linkSlots = [];
  text = text.replace(/<a href="[^"]*">.*?<\/a>/g, anchor => {
    const idx = linkSlots.length;
    linkSlots.push(anchor);
    return `\x00LINK_${idx}\x00`;
  });

  text = parseEmphasis(text);

  text = text.replace(/\x00LINK_(\d+)\x00/g, (_, idx) => linkSlots[Number(idx)]);

  text = text.replace(/\x00CODE_(\d+)\x00/g, (_, idx) => {
    return `<code>${esc(codeSlots[Number(idx)])}</code>`;
  });

  return text;
}

function isHorizontalRule(line) {
  return /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line);
}

function splitTableCells(line) {
  let trimmed = line.trim();
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
  const cells = [];
  let current = '';
  let inCode = false;
  for (let idx = 0; idx < trimmed.length; idx++) {
    const ch = trimmed[idx];
    if (ch === '`') {
      inCode = !inCode;
      current += ch;
    } else if (ch === '|' && !inCode) {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

function isTableDelimiterRow(line, expectedColCount) {
  if (!line || !line.trim()) return false;
  if (!line.includes('-')) return false;
  const cells = splitTableCells(line);
  if (cells.length !== expectedColCount) return false;
  return cells.every(c => /^[:\-\s]+$/.test(c) && /-/.test(c));
}

function trimHeadingContent(raw) {
  const content = raw.trim();
  if (/^#+$/.test(content)) {
    return '';
  }
  return content.replace(/\s+#+\s*$/, '').trim();
}

export function renderMarkdown(input) {
  if (typeof input !== 'string') {
    throw new TypeError('input must be a string');
  }
  if (input === '') {
    return '';
  }

  const normalized = input.replace(/\r\n|\r/g, '\n');
  const lines = normalized.split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i++;
      continue;
    }

    // Fenced code block
    if (/^\s*```(.*)$/.test(line)) {
      const codeLines = [];
      i++;
      while (i < lines.length) {
        if (/^\s*```\s*$/.test(lines[i])) {
          i++;
          break;
        }
        codeLines.push(lines[i]);
        i++;
      }
      blocks.push(`<pre><code>${esc(codeLines.join('\n'))}</code></pre>`);
      continue;
    }

    // GFM Table
    if (line.includes('|') && i + 1 < lines.length) {
      const headerCells = splitTableCells(line);
      if (headerCells.length > 0 && isTableDelimiterRow(lines[i + 1], headerCells.length)) {
        const colCount = headerCells.length;
        let rowIdx = i + 2;
        const bodyRows = [];
        while (rowIdx < lines.length) {
          const rowLine = lines[rowIdx];
          if (rowLine.trim() === '') break;
          if (/^\s*```/.test(rowLine)) break;
          if (/^#{1,6}\s+/.test(rowLine)) break;
          if (isHorizontalRule(rowLine) && !rowLine.includes('|')) break;
          if (!rowLine.includes('|')) break;

          let rowCells = splitTableCells(rowLine);
          if (rowCells.length > colCount) {
            rowCells = rowCells.slice(0, colCount);
          } else {
            while (rowCells.length < colCount) {
              rowCells.push('');
            }
          }
          bodyRows.push(rowCells);
          rowIdx++;
        }

        const ths = headerCells.map(c => `<th>${parseInline(c)}</th>`).join('');
        const thead = `<thead>\n<tr>${ths}</tr>\n</thead>`;
        const trs = bodyRows.map(r => `<tr>${r.map(c => `<td>${parseInline(c)}</td>`).join('')}</tr>`);
        const tbody = `<tbody>\n${trs.length > 0 ? trs.join('\n') + '\n' : ''}</tbody>`;
        blocks.push(`<table>\n${thead}\n${tbody}\n</table>`);
        i = rowIdx;
        continue;
      }
    }

    // ATX heading
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const content = trimHeadingContent(headingMatch[2]);
      blocks.push(`<h${level}>${parseInline(content)}</h${level}>`);
      i++;
      continue;
    }

    // Horizontal rule
    if (isHorizontalRule(line)) {
      blocks.push('<hr>');
      i++;
      continue;
    }

    // Lists (ul / ol)
    const ulMatch = line.match(/^ {0,1}([-*+])\s+(.*)$/);
    const olMatch = line.match(/^ {0,1}(\d+)\.\s+(.*)$/);
    if (ulMatch || olMatch) {
      const isUl = Boolean(ulMatch);
      const items = [ulMatch ? ulMatch[2] : olMatch[2]];
      i++;
      while (i < lines.length) {
        const curLine = lines[i];
        if (curLine.trim() === '') break;
        if (/^\s*```/.test(curLine)) break;
        if (/^#{1,6}\s+/.test(curLine)) break;
        if (isHorizontalRule(curLine)) break;

        // Indented line (>= 2 spaces or tab)
        if (/^(?: {2,}|\t)/.test(curLine)) {
          items[items.length - 1] += ' ' + curLine.trim();
          i++;
          continue;
        }

        if (isUl) {
          const nextUl = curLine.match(/^ {0,1}([-*+])\s+(.*)$/);
          if (nextUl) {
            items.push(nextUl[2]);
            i++;
            continue;
          }
        } else {
          const nextOl = curLine.match(/^ {0,1}(\d+)\.\s+(.*)$/);
          if (nextOl) {
            items.push(nextOl[2]);
            i++;
            continue;
          }
        }

        break;
      }

      const tag = isUl ? 'ul' : 'ol';
      const lis = items.map(it => `<li>${parseInline(it)}</li>`).join('\n');
      blocks.push(`<${tag}>\n${lis}\n</${tag}>`);
      continue;
    }

    // Paragraph
    const paraLines = [line.trim()];
    i++;
    while (i < lines.length) {
      const nextLine = lines[i];
      if (nextLine.trim() === '') break;
      if (/^\s*```/.test(nextLine)) break;
      if (/^#{1,6}\s+/.test(nextLine)) break;
      if (isHorizontalRule(nextLine)) break;
      if (/^ {0,1}(?:[-*+]|\d+\.)\s+/.test(nextLine)) break;
      if (nextLine.includes('|') && i + 1 < lines.length) {
        const candidateCells = splitTableCells(nextLine);
        if (candidateCells.length > 0 && isTableDelimiterRow(lines[i + 1], candidateCells.length)) {
          break;
        }
      }
      paraLines.push(nextLine.trim());
      i++;
    }

    blocks.push(`<p>${parseInline(paraLines.join(' '))}</p>`);
  }

  return blocks.join('\n');
}
