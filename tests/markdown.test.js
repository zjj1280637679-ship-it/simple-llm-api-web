import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../src/markdown.js';

test('子集元素：h1 标题', () => {
  assert.strictEqual(renderMarkdown('# Heading 1'), '<h1>Heading 1</h1>');
  assert.strictEqual(renderMarkdown('# Heading with trailing # ###'), '<h1>Heading with trailing #</h1>');
});

test('子集元素：h3 标题', () => {
  assert.strictEqual(renderMarkdown('### Sub Section'), '<h3>Sub Section</h3>');
  assert.strictEqual(renderMarkdown('### Sub Section #'), '<h3>Sub Section</h3>');
});

test('子集元素：段落与单行换行连接', () => {
  const input = 'Line one\nLine two\n\nSecond paragraph';
  const expected = '<p>Line one Line two</p>\n<p>Second paragraph</p>';
  assert.strictEqual(renderMarkdown(input), expected);
});

test('子集元素：ul 无序列表（- 开头）', () => {
  const input = '- Item A\n- Item B';
  const expected = '<ul>\n<li>Item A</li>\n<li>Item B</li>\n</ul>';
  assert.strictEqual(renderMarkdown(input), expected);
});

test('子集元素：ul 无序列表（* 开头）', () => {
  const input = '* Star A\n* Star B';
  const expected = '<ul>\n<li>Star A</li>\n<li>Star B</li>\n</ul>';
  assert.strictEqual(renderMarkdown(input), expected);
});

test('子集元素：ul 无序列表（+ 开头）', () => {
  const input = '+ Plus A\n+ Plus B';
  const expected = '<ul>\n<li>Plus A</li>\n<li>Plus B</li>\n</ul>';
  assert.strictEqual(renderMarkdown(input), expected);
});

test('子集元素：ol 有序列表', () => {
  const input = '1. First item\n2. Second item';
  const expected = '<ol>\n<li>First item</li>\n<li>Second item</li>\n</ol>';
  assert.strictEqual(renderMarkdown(input), expected);
});

test('子集元素：围栏代码块', () => {
  const input = '```javascript\nconst x = 10;\nconsole.log(x);\n```';
  const expected = '<pre><code>const x = 10;\nconsole.log(x);</code></pre>';
  assert.strictEqual(renderMarkdown(input), expected);
});

test('子集元素：GFM 表格', () => {
  const input = '| Name | Role |\n| --- | --- |\n| Alice | Admin |\n| Bob | User |';
  const expected = '<table>\n<thead>\n<tr><th>Name</th><th>Role</th></tr>\n</thead>\n<tbody>\n<tr><td>Alice</td><td>Admin</td></tr>\n<tr><td>Bob</td><td>User</td></tr>\n</tbody>\n</table>';
  assert.strictEqual(renderMarkdown(input), expected);
});

test('子集元素：水平线（---、***、___）', () => {
  assert.strictEqual(renderMarkdown('---'), '<hr>');
  assert.strictEqual(renderMarkdown('***'), '<hr>');
  assert.strictEqual(renderMarkdown('___'), '<hr>');
});

test('子集元素：行内代码', () => {
  assert.strictEqual(renderMarkdown('Here is `const x = 1` in text'), '<p>Here is <code>const x = 1</code> in text</p>');
});

test('子集元素：链接', () => {
  const input = 'Check [Example](https://example.com) for details.';
  const expected = '<p>Check <a href="https://example.com">Example</a> for details.</p>';
  assert.strictEqual(renderMarkdown(input), expected);
});

test('子集元素：加粗', () => {
  assert.strictEqual(renderMarkdown('Some **bold text** here'), '<p>Some <strong>bold text</strong> here</p>');
});

test('子集元素：斜体', () => {
  assert.strictEqual(renderMarkdown('Some *italic text* here'), '<p>Some <em>italic text</em> here</p>');
});

test('对抗样本：script 标签转义', () => {
  const out = renderMarkdown('<script>alert("xss")</script>');
  assert.strictEqual(out, '<p>&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;</p>');
});

test('对抗样本：img onerror 转义', () => {
  const out = renderMarkdown('<img src=x onerror=alert(1)>');
  assert.strictEqual(out, '<p>&lt;img src=x onerror=alert(1)&gt;</p>');
});

test('对抗样本：javascript: 链接降级', () => {
  const out = renderMarkdown('[click](javascript:alert(1))');
  assert.strictEqual(out, '<p>[click](javascript:alert(1))</p>');
  assert.strictEqual(out.includes('<a'), false);
});

test('对抗样本：data: 链接降级', () => {
  const out = renderMarkdown('[click](data:text/html,<script>alert(1)</script>)');
  assert.strictEqual(out, '<p>[click](data:text/html,&lt;script&gt;alert(1)&lt;/script&gt;)</p>');
  assert.strictEqual(out.includes('<a'), false);
});

test('对抗样本：href 含引号逃逸降级', () => {
  const doubleQuote = renderMarkdown('[click](https://example.com" onclick="alert(1))');
  assert.strictEqual(doubleQuote, '<p>[click](https://example.com&quot; onclick=&quot;alert(1))</p>');
  assert.strictEqual(doubleQuote.includes('<a'), false);

  const singleQuote = renderMarkdown("[click](https://example.com' onclick='alert(1))");
  assert.strictEqual(singleQuote, '<p>[click](https://example.com&#39; onclick=&#39;alert(1))</p>');
  assert.strictEqual(singleQuote.includes('<a'), false);
});

test('对抗样本：围栏内含 Markdown 标记逐字保真', () => {
  const input = '```\n# Not H1\n**not bold**\n[not link](https://x.com)\n- not list\n```';
  const out = renderMarkdown(input);
  assert.strictEqual(out, '<pre><code># Not H1\n**not bold**\n[not link](https://x.com)\n- not list</code></pre>');
});

test('对抗样本：行内代码内含 ** 与 [链接] 不解析', () => {
  const input = '`**not bold** and [not link](https://example.com)`';
  const out = renderMarkdown(input);
  assert.strictEqual(out, '<p><code>**not bold** and [not link](https://example.com)</code></p>');
});

test('空输入', () => {
  assert.strictEqual(renderMarkdown(''), '');
});

test('非字符串抛 TypeError', () => {
  assert.throws(() => renderMarkdown(null), TypeError);
  assert.throws(() => renderMarkdown(undefined), TypeError);
  assert.throws(() => renderMarkdown(123), TypeError);
  assert.throws(() => renderMarkdown(true), TypeError);
  assert.throws(() => renderMarkdown({}), TypeError);
  assert.throws(() => renderMarkdown([]), TypeError);
});

test('CRLF 归一化', () => {
  const input = '# Heading\r\nLine 1\rLine 2\r\n\r\nLine 3';
  const expected = '<h1>Heading</h1>\n<p>Line 1 Line 2</p>\n<p>Line 3</p>';
  assert.strictEqual(renderMarkdown(input), expected);
});

test('未闭合强调原样保留', () => {
  const input = '**unclosed bold and *unclosed italic';
  assert.strictEqual(renderMarkdown(input), '<p>**unclosed bold and *unclosed italic</p>');
});

test('链接降级后无 <a', () => {
  const badLinks = [
    '[bad](javascript:alert(1))',
    '[bad](data:text/html,abc)',
    '[bad](vbscript:msgbox(1))',
    '[bad](/relative/path)',
    '[bad](#anchor)',
    '[bad](https://example.com" onclick="alert(1))',
    '[bad](https://example.com/foo bar)',
  ];
  for (const item of badLinks) {
    const out = renderMarkdown(item);
    assert.strictEqual(out.includes('<a'), false, `Must not contain <a for: ${item}`);
  }
});

test('表格分隔行判定失败时按段落处理', () => {
  const input = '| A | B |\n| invalid | delimiter |\n| 1 | 2 |';
  const out = renderMarkdown(input);
  assert.strictEqual(out.includes('<table'), false);
  assert.strictEqual(out, '<p>| A | B | | invalid | delimiter | | 1 | 2 |</p>');
});

test('表格多余格丢弃缺失格补空', () => {
  const input = '| H1 | H2 |\n| --- | --- |\n| A | B | C |\n| D |';
  const expected = '<table>\n<thead>\n<tr><th>H1</th><th>H2</th></tr>\n</thead>\n<tbody>\n<tr><td>A</td><td>B</td></tr>\n<tr><td>D</td><td></td></tr>\n</tbody>\n</table>';
  assert.strictEqual(renderMarkdown(input), expected);
});

test('扁平列表缩进项拼入上一项', () => {
  const input = '- item 1\n  continuation text\n  - subitem';
  const expected = '<ul>\n<li>item 1 continuation text - subitem</li>\n</ul>';
  assert.strictEqual(renderMarkdown(input), expected);
});

test('连续同类列表项合并与不同类相邻各自成表', () => {
  const input = '- u1\n* u2\n+ u3\n1. o1\n2. o2';
  const expected = '<ul>\n<li>u1</li>\n<li>u2</li>\n<li>u3</li>\n</ul>\n<ol>\n<li>o1</li>\n<li>o2</li>\n</ol>';
  assert.strictEqual(renderMarkdown(input), expected);
});

test('未闭合围栏代码块直至文末', () => {
  const input = '```\nline 1\nline 2';
  const expected = '<pre><code>line 1\nline 2</code></pre>';
  assert.strictEqual(renderMarkdown(input), expected);
});

test('回归：href 含 * 时强调解析不得改写锚点（主线复核发现）', () => {
  assert.strictEqual(
    renderMarkdown('[x](https://example.com/a**b**c)'),
    '<p><a href="https://example.com/a**b**c">x</a></p>'
  );
  assert.strictEqual(
    renderMarkdown('[x](https://example.com/a*b) and *em*'),
    '<p><a href="https://example.com/a*b">x</a> and <em>em</em></p>'
  );
  // 强调包裹链接的行为保持不变。
  assert.strictEqual(
    renderMarkdown('*a [b](https://example.com) c*'),
    '<p><em>a <a href="https://example.com">b</a> c</em></p>'
  );
});

test('形式不变量：对一组对抗输入断言输出中不存在 <script 且不存在 on*= 事件属性形态', () => {
  const adversarial = [
    '<script>alert(1)</script>',
    '<SCRIPT SRC="https://evil.com/x.js"></SCRIPT>',
    '<script\n>alert(1)</script>',
    '<script/x>alert(1)</script>',
    '# <script>alert(1)</script>',
    '### <script>alert(1)</script>',
    '- <script>alert(1)</script>',
    '1. <script>alert(1)</script>',
    '| <script> | col |\n| --- | --- |\n| cell | cell |',
    '```\n<script>alert(1)</script>\n```',
    '`<script>alert(1)</script>`',
    '**<script>alert(1)</script>**',
    '*<script>alert(1)</script>*',
    '[<script>alert(1)</script>](https://example.com)',
    '[payload](javascript:alert(1))',
    '[payload](JAVASCRIPT:alert(1))',
    '[payload](data:text/html;base64,PHNjcmlwdD4=)',
    '[payload](vbscript:alert(1))',
    '[payload](/relative/path)',
    '[payload](#anchor)',
  ];

  for (const item of adversarial) {
    const out = renderMarkdown(item);
    assert.strictEqual(/<script/i.test(out), false, `output contains <script: ${out}`);
    assert.strictEqual(/\son\w+\s*=/i.test(out), false, `output contains on*= event attribute: ${out}`);
  }
});

test('形式不变量：所有生成的 href 均以 http:// 或 https:// 开头', () => {
  const mixedInput = `
# Links Test

[link1](http://example.com/one)
[link2](https://example.com/two?a=1&b=2)
[link3](HTTP://EXAMPLE.COM/UPPER)
[bad1](javascript:alert(1))
[bad2](data:text/html,abc)
[bad3](https://example.com" onclick="alert(1))
[bad4](/path/to/page)
[bad5](#target)
[link4](https://secure.example.org/path#hash)
`;
  const out = renderMarkdown(mixedInput);
  const hrefs = [...out.matchAll(/<a\s+[^>]*href="([^"]*)"/g)].map(m => m[1]);
  assert.ok(hrefs.length >= 4, 'should have extracted at least 4 valid links');
  for (const href of hrefs) {
    assert.ok(/^https?:\/\//i.test(href), `href must start with http:// or https://: ${href}`);
  }
});

test('形式不变量：代码块与行内代码内容逐字保真', () => {
  const codeBlockContent = 'const a = 1 < 2 && "quote";\n# Not H1\n**not bold**\n[not link](http://example.com)\n| not | table |';
  const inlineCodeContent = 'x < y && z > 0 "string" **not bold** [not link](http://example.com)';
  const input = '```\n' + codeBlockContent + '\n```\n\n`' + inlineCodeContent + '`';
  const out = renderMarkdown(input);

  const escReference = value =>
    String(value ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c]));

  const expectedCodeBlock = '<pre><code>' + escReference(codeBlockContent) + '</code></pre>';
  const expectedInlineCode = '<code>' + escReference(inlineCodeContent) + '</code>';

  assert.ok(out.includes(expectedCodeBlock), 'code block verbatim content must match');
  assert.ok(out.includes(expectedInlineCode), 'inline code verbatim content must match');
});

test('形式不变量：输出标签白名单与属性约束', () => {
  const complexInput = `
# Title

Paragraph with **bold**, *italic*, \`code\`, and [link](https://example.com).

- item 1
  continuation
- item 2

1. first
2. second

---

| Col A | Col B |
| --- | --- |
| Val 1 | Val 2 |

\`\`\`
code block
\`\`\`
`;
  const out = renderMarkdown(complexInput);
  const allowedTags = new Set([
    'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li', 'pre', 'code',
    'strong', 'em', 'a',
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr'
  ]);

  for (const match of out.matchAll(/<([a-zA-Z0-9]+)(\s+[^>]*)?>/g)) {
    const tagName = match[1].toLowerCase();
    const attrs = match[2] || '';
    assert.ok(allowedTags.has(tagName), `Tag <${tagName}> not in allowed whitelist`);
    if (tagName === 'a') {
      assert.ok(/^\s+href="https?:\/\/[^"]*"$/.test(attrs), `Anchor attributes invalid: ${attrs}`);
    } else {
      assert.strictEqual(attrs.trim(), '', `Tag <${tagName}> must not contain attributes: ${attrs}`);
    }
  }
});
