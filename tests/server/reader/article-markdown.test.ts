import { describe, expect, it } from 'vitest'
import { articleMarkdown } from '../../../src/server/reader/article-markdown.js'

const BASE = 'https://publisher.example/writing/article'

describe('article structure', () => {
  it('keeps headings, paragraphs, and emphasis', () => {
    const markdown = articleMarkdown(
      `<h2>The shape of it</h2>
       <p>Three years after <em>naming</em> the problem, the shape has <strong>not moved</strong>.</p>`,
      BASE,
    )

    expect(markdown).toBe(
      '## The shape of it\n\nThree years after *naming* the problem, the shape has **not moved**.',
    )
  })

  it('keeps nested and ordered lists', () => {
    const markdown = articleMarkdown(
      `<ul><li>reduce capability<ul><li>of the model</li></ul></li><li>separate the planner</li></ul>
       <ol><li>first</li><li>second</li></ol>`,
      BASE,
    )

    expect(markdown).toBe(
      '- reduce capability\n  - of the model\n- separate the planner\n\n1. first\n2. second',
    )
  })

  it('keeps block quotes, including quoted paragraphs', () => {
    const markdown = articleMarkdown(
      '<blockquote><p>The only defence I trust.</p><p>The rest is risk management.</p></blockquote>',
      BASE,
    )

    expect(markdown).toBe('> The only defence I trust.\n>\n> The rest is risk management.')
  })

  it('keeps code blocks with their language and inline code', () => {
    const markdown = articleMarkdown(
      `<p>Run <code>pnpm test</code> first.</p>
       <pre><code class="language-ts">const a = b &lt; c</code></pre>`,
      BASE,
    )

    expect(markdown).toBe('Run `pnpm test` first.\n\n```ts\nconst a = b < c\n```')
  })

  it('fences code with more backticks than the code contains', () => {
    const markdown = articleMarkdown('<pre><code>a ``` fence</code></pre>', BASE)

    expect(markdown).toBe('````\na ``` fence\n````')
  })

  it('keeps tables as header, divider, and rows', () => {
    const markdown = articleMarkdown(
      `<table>
         <thead><tr><th>Name</th><th>Role</th></tr></thead>
         <tbody><tr><td>feed</td><td>polling</td></tr><tr><td>reader</td><td>extraction</td></tr></tbody>
       </table>`,
      BASE,
    )

    expect(markdown).toBe(
      '| Name | Role |\n| --- | --- |\n| feed | polling |\n| reader | extraction |',
    )
  })

  it('keeps supported math as TeX delimiters', () => {
    const markdown = articleMarkdown(
      `<p>Euler said <math display="inline" data-latex="e^{i\\pi} = -1"><mrow></mrow></math>.</p>
       <math display="block" data-latex="\\int_0^1 x\\,dx"><mrow></mrow></math>`,
      BASE,
    )

    expect(markdown).toBe('Euler said $e^{i\\pi} = -1$.\n\n$$\n\\int_0^1 x\\,dx\n$$')
  })

  it('keeps thematic breaks, and writes a `<br>` as a hard line break', () => {
    const markdown = articleMarkdown('<p>one<br>two</p><hr><p>three</p>', BASE)

    // The trailing `\` is what makes the newline survive CommonMark, which
    // would otherwise read it as a space between two lines of one paragraph.
    expect(markdown).toBe('one\\\ntwo\n\n---\n\nthree')
  })

  it('unwraps divs, spans, sections, and figures to their content', () => {
    const markdown = articleMarkdown(
      '<section><div><p>A <span>quiet</span> paragraph.</p></div><figure><figcaption>A caption.</figcaption></figure></section>',
      BASE,
    )

    expect(markdown).toBe('A quiet paragraph.\n\nA caption.')
  })
})

describe('links', () => {
  it('keeps links and resolves relative addresses against the article', () => {
    const markdown = articleMarkdown('<p>See <a href="/notes">the notes</a>.</p>', BASE)

    expect(markdown).toBe('See [the notes](https://publisher.example/notes).')
  })

  it('keeps only http and https link destinations', () => {
    const markdown = articleMarkdown(
      '<p><a href="javascript:alert(1)">run</a> or <a href="data:text/html,x">peek</a> or <a href="ftp://host/file">fetch</a></p>',
      BASE,
    )

    expect(markdown).toBe('run or peek or fetch')
  })

  it('drops links whose destination does not parse', () => {
    const markdown = articleMarkdown('<p><a href="https://exa mple">broken</a></p>', BASE)

    expect(markdown).toBe('broken')
  })
})

describe('images', () => {
  const sign = (url: string) => `/api/reader/image?url=${encodeURIComponent(url)}&exp=99&sig=mac`

  it('rewrites approved images to the signed proxy path, resolving relative sources', () => {
    const markdown = articleMarkdown('<img src="/photos/morning.jpg" alt="First [light]">', BASE, {
      signImageUrl: sign,
    })

    expect(markdown).toBe(
      '![First \\[light\\]](/api/reader/image?url=https%3A%2F%2Fpublisher.example%2Fphotos%2Fmorning.jpg&exp=99&sig=mac)',
    )
  })

  it('keeps an image inline within its paragraph', () => {
    const markdown = articleMarkdown(
      '<p>Before <img src="https://publisher.example/a.png" alt="a chart"> after.</p>',
      BASE,
      { signImageUrl: sign },
    )

    expect(markdown).toBe(
      'Before ![a chart](/api/reader/image?url=https%3A%2F%2Fpublisher.example%2Fa.png&exp=99&sig=mac) after.',
    )
  })

  it('renders the img inside a picture and drops its sources', () => {
    const markdown = articleMarkdown(
      '<picture><source srcset="big.avif" type="image/avif"><img src="fallback.jpg" alt="the valley"></picture>',
      BASE,
      { signImageUrl: sign },
    )

    expect(markdown).toBe(
      '![the valley](/api/reader/image?url=https%3A%2F%2Fpublisher.example%2Fwriting%2Ffallback.jpg&exp=99&sig=mac)',
    )
  })

  it('signs only http and https image sources', () => {
    const markdown = articleMarkdown(
      '<p>kept</p><img src="data:image/png;base64,x" alt="inline"><img src="javascript:alert(1)" alt="run"><img alt="no source">',
      BASE,
      { signImageUrl: sign },
    )

    expect(markdown).toBe('kept')
  })

  it('escapes parentheses so a source cannot end the markdown destination early', () => {
    const markdown = articleMarkdown('<img src="https://publisher.example/a(1).png" alt="x">', BASE, {
      signImageUrl: (url) => `/api/reader/image?url=${url}`,
    })

    expect(markdown).toBe('![x](/api/reader/image?url=https://publisher.example/a%281%29.png)')
  })

  it('drops images entirely when no signer is offered', () => {
    const markdown = articleMarkdown('<p>kept</p><img src="https://publisher.example/a.png" alt="a chart">', BASE)

    expect(markdown).toBe('kept')
  })
})

describe('sanitization', () => {
  it('removes scripts, styles, and templates with their content', () => {
    const markdown = articleMarkdown(
      '<p>before</p><script>alert(1)</script><style>p{display:none}</style><noscript>x</noscript><template><p>y</p></template><p>after</p>',
      BASE,
    )

    expect(markdown).toBe('before\n\nafter')
  })

  it('removes forms and their controls with their content', () => {
    const markdown = articleMarkdown(
      '<form action="/subscribe"><label>email<input value="x"></label><button>join</button></form><p>kept</p>',
      BASE,
    )

    expect(markdown).toBe('kept')
  })

  it('removes iframes and embedded media', () => {
    const markdown = articleMarkdown(
      `<p>kept</p>
       <iframe src="https://tracker.example"></iframe>
       <video src="v.mp4">fallback</video><audio src="a.mp3"></audio>
       <object data="o.swf">obj</object><embed src="e.swf">
       <img src="x.png" alt="a chart"><svg><circle r="4"/></svg><canvas></canvas>`,
      BASE,
    )

    expect(markdown).toBe('kept')
  })

  it('cannot carry event handlers or attributes into the markdown', () => {
    const markdown = articleMarkdown(
      '<p onmouseover="steal()">calm</p><a href="https://ok.example" onclick="steal()">fine</a>',
      BASE,
    )

    expect(markdown).toBe('calm\n\n[fine](https://ok.example/)')
  })

  it('escapes markdown syntax found in article text', () => {
    const markdown = articleMarkdown('<p>a *b* _c_ [d] `e` | $f$ ~g~ \\h</p>', BASE)

    expect(markdown).toBe('a \\*b\\* \\_c\\_ \\[d\\] \\`e\\` \\| \\$f\\$ \\~g\\~ \\\\h')
  })

  it('escapes text lines that would begin a markdown block', () => {
    const markdown = articleMarkdown('<p># not a heading<br>&gt; not a quote<br>- not a list<br>1. not ordered</p>', BASE)

    expect(markdown).toBe('\\# not a heading\\\n\\> not a quote\\\n\\- not a list\\\n1\\. not ordered')
  })

  it('never passes raw HTML through as markup', () => {
    const markdown = articleMarkdown('<p>literal &lt;img src=x onerror=alert(1)&gt; tag</p>', BASE)

    expect(markdown).toBe('literal \\<img src=x onerror=alert(1)> tag')
  })

  it('drops empty output rather than inventing structure', () => {
    expect(articleMarkdown('<script>x</script><div>  </div>', BASE)).toBe('')
  })
})
