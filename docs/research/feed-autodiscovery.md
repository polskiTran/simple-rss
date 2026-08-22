# Feed autodiscovery: what a discovery operation must honour

Research for [#40](https://github.com/polskiTran/simple-rss/issues/40), part of map [#38](https://github.com/polskiTran/simple-rss/issues/38). Read 2026-08-22 against the primary sources named per claim: the three autodiscovery specs, the WHATWG HTML Standard, reader source at pinned commits, and the publisher code that emits most declarations on the web. Anything not reached is listed at the end under "Unreachable".

## Summary

1. **Types.** Every spec agrees on exactly two declarations: `<link rel="alternate" type="application/rss+xml">` and `<link rel="alternate" type="application/atom+xml">`. `application/xml`, `text/xml` and `application/rdf+xml` are not declarations in any spec. In the wild they are rare but real (WordPress keeps `text/xml` in its feed content-type table; SimplePie sniffs fetched bodies for seven XML types). None of the four readers whose source was read — Miniflux, NetNewsWire, FreshRSS/SimplePie, Feedbin — honours a `<link type="text/xml">` or `application/xml` declaration, and neither did Firefox's own feed sniffer. Feedly's and Inoreader's public docs name only `application/rss+xml` / "a meta link". Honouring the two spec types is enough.
2. **Relative `href`.** Resolve against the document base URL: the first `<base href>` in tree order if there is one, otherwise the document's URL. The document's URL is the post-redirect URL. Miniflux honours an absolute `<base href>`; NetNewsWire ignores `<base>` and resolves against the URL the user typed, not the final one.
3. **Order.** The first declaration in tree order is the default feed. All three specs say so; HTML says "should"; WordPress (the largest emitter) prints the posts feed first and the comments feed second. Miniflux returns every declaration in document order and makes the user choose when there is more than one; NetNewsWire scores them, and document order dominates its score.
4. **Outside `<head>`.** `alternate` is not a body-ok keyword, so a `<link rel=alternate>` in `<body>` is a conformance error — but the HTML parser still builds the element, and the Standard's autodiscovery rule counts "all `link` elements in the document". Miniflux, SimplePie, Feedbin and Firefox scan the whole document; NetNewsWire stops at `<body>` except on YouTube, which is its worked example of feeds declared in the body.
5. **How far to read.** A parser-faithful answer is "to the end": nothing forbids a late `<link>`. A spec-faithful answer is "to `</head>`", and the median HTML document is 18 KB. No reader caps the page separately from the feed: Miniflux caps both at 15 MiB and fails hard; Feedbin and feedsearch-crawler cap at 10 MiB (Feedbin truncates, feedsearch fails); NetNewsWire and FreshRSS have no cap. A discovery profile of **1 MiB** reads past every conformant `<head>` by two orders of magnitude; a truncated body still parses, so the cap should truncate and scan, not fail.
6. **JSON Feed (out of scope).** `<link rel="alternate" type="application/feed+json" href="…">`, by the JSON Feed 1.1 spec; `application/json` is the legacy form, and Miniflux and Feedbin accept both.

## 1. Which `type` values count

### What the specs say

- **RSS Advisory Board, RSS Autodiscovery 1.0 (2006-11-27)**: "The type attribute must contain the feed's MIME type, which is "application/rss+xml" for RSS 1.0 or RSS 2.0 feeds." Also: "The rel attribute must have a value of "alternate"" and the `rel` value must not contain other keywords. Note it tells RSS 1.0 (RDF) publishers to use `application/rss+xml`, not `application/rdf+xml`. — https://www.rssboard.org/rss-autodiscovery
- **Atom autodiscovery, draft-ietf-atompub-autodiscovery-01 (Pilgrim, Ringnalda; 2005-05-10, expired)**: `rel` must include `alternate`; `type` must be `application/atom+xml`, case-insensitive. — https://datatracker.ietf.org/doc/html/draft-ietf-atompub-autodiscovery-01
- **draft-snell-atompub-autodiscovery-00 (Pilgrim, Snell; 2006-11-22, expired)**, the individual submission that replaced it: "the value of the type attribute MUST contain the string 'application/atom+xml' in uppercase, lowercase, or mixed case." — https://datatracker.ietf.org/doc/html/draft-snell-atompub-autodiscovery-00
- **RFC 4287 §7** registers `application/atom+xml` and says nothing about HTML or autodiscovery; the `Applications that use this media type` line still reads "No known applications currently use this media type." The link-element convention lives only in the drafts above and in HTML. — https://www.rfc-editor.org/rfc/rfc4287.html#section-7
- **WHATWG HTML Standard, §4.6.6.1 "Link type alternate"**: "For the purposes of feed autodiscovery, user agents should consider all `link` elements in the document with the `alternate` keyword used and with their `type` attribute set to the value `application/rss+xml` or the value `application/atom+xml`." — https://html.spec.whatwg.org/multipage/links.html#rel-alternate
  - History: HTML5 briefly had `rel="feed"`; WHATWG r4111 (2009-10-12) removed it "in favour of rel=alternate with specific types". — https://lists.w3.org/Archives/Public/public-html-diffs/2009Oct/0042.html. Hickson on why the type-based inference exists at all (2006-11-29): "It is intentional, as a way of grandfathering widespread legacy practice." — https://lists.w3.org/Archives/Public/public-whatwg-archive/2006Nov/0489.html
- **JSON Feed 1.1** adds `application/feed+json` (§6 below).

No spec names `application/xml`, `text/xml` or `application/rdf+xml` as a declaration.

### Do `application/xml` / `text/xml` declarations occur in the wild?

Yes, but as a tail, and the evidence is indirect (no corpus measurement of `<link type>` values was found; the Web Almanac markup chapters count `rel` values, not feed types):

- **WordPress** `feed_content_type()` maps `'rss-http' => 'text/xml'` and `'rdf' => 'application/rdf+xml'` alongside `'rss2' => 'application/rss+xml'` and `'atom' => 'application/atom+xml'`. `feed_links()` prints `type="%s"` from `feed_content_type()` of the *default* feed, which is `rss2`, so a stock WordPress page declares `application/rss+xml`; `text/xml` only appears if a site changes its default feed. — https://github.com/WordPress/WordPress/blob/master/wp-includes/feed.php (`feed_content_type`), https://github.com/WordPress/WordPress/blob/master/wp-includes/general-template.php (`feed_links`)
- **jekyll-feed** (the GitHub Pages default) hard-codes `:type => "application/atom+xml", :rel => "alternate"`. — https://github.com/jekyll/jekyll-feed/blob/master/lib/jekyll-feed/meta-tag.rb
- **SimplePie** knows the wider list — `['application/rss+xml', 'application/rdf+xml', 'text/rdf', 'application/atom+xml', 'text/xml', 'application/xml', 'application/x-rss+xml']` in `Locator::is_feed()` — but applies it to the *sniffed Content-Type of a fetched candidate*, not to `<link type>`. Its `<link>` filter is the spec pair plus `text/html`. That is the shape of the wild: feeds are *served* as `text/xml`/`application/xml` all the time (this repo's own `feed` profile accepts both), but they are *declared* with the `+xml` types. — https://github.com/simplepie/simplepie/blob/18957a8d1ed93bc4cd502454287851ad3e172229/src/Locator.php#L165-L186, L250–263
- **Firefox's feed preview** (ESR 60, the last series that had it) accepted only `application/rss+xml` and `application/atom+xml` by type, after stripping `;` parameters — but let a `rel` containing the token `feed` bypass the type check entirely. That escape hatch is Mozilla's accommodation of the tail: a `<link rel="alternate feed" type="text/xml">` counted, a bare `type="text/xml"` did not. — https://hg-edge.mozilla.org/releases/mozilla-esr60/raw-file/tip/browser/modules/Feeds.jsm (`isValidFeed`), https://hg-edge.mozilla.org/releases/mozilla-esr60/raw-file/tip/browser/base/content/content.js (`getFeedsInfo`)

### What readers honour

| Reader | Accepted `type` values for a `<link>` declaration | `rel` check |
|---|---|---|
| Miniflux | exactly `application/rss+xml`, `application/atom+xml`, `application/feed+json`, `application/json` (the last skipped when `href` contains `/wp-json/`); exact, case-sensitive string match; `application/xml`, `text/xml`, `application/rdf+xml` fall to `default: return` | none — `rel` is never read |
| NetNewsWire | any `type` ending `/rss+xml`, `/atom+xml` or `/json` (case-insensitive), **or no `type` at all**; `application/feed+json` fails (ends in `+json`, not `/json`); `application/xml`, `text/xml`, `application/rdf+xml` rejected | `rel` must equal `alternate` (not tokenised); rejected if `media` or `hreflang` is set |
| Feedbin | `application/rss+xml`, `application/atom+xml`, `application/feed+json`, `application/json`, after `strip.downcase`; `application/xml`, `text/xml`, `application/rdf+xml` rejected | `link[rel~=alternate]` — token match |
| Firefox ESR 60 (historical) | `application/rss+xml`, `application/atom+xml`, lower-cased, `;…` parameter stripped; any type (or none) if `rel` contains `feed` | tokenised; needs `feed`, or `alternate` without `stylesheet` plus a non-empty `type` |
| FreshRSS (SimplePie `Locator`) | `rel` contains `feed` (any or no `type`), **or** `rel` contains `alternate` and not `stylesheet` with `type` (after `parse_mime`, lower-cased) in `['text/html', 'application/rss+xml', 'application/atom+xml']`; `application/rdf+xml`, `text/xml`, `application/xml` not accepted on the tag | `rel` tokenised on whitespace, lower-cased |

Sources: Miniflux `internal/reader/subscription/finder.go` L144–162 at commit `106cdd09` — https://github.com/miniflux/v2/blob/106cdd09e1557222303f3ed1376e1dadf0638621/internal/reader/subscription/finder.go ; SimplePie `src/Locator.php` L250–263 at commit `18957a8d` (byte-identical to the copy FreshRSS vendors at `lib/simplepie/simplepie/src/Locator.php`, FreshRSS `edge` @ `95842d81`) — https://github.com/simplepie/simplepie/blob/18957a8d1ed93bc4cd502454287851ad3e172229/src/Locator.php ; Feedbin `app/models/source/meta_links.rb` (`link_valid?`) — https://github.com/feedbin/feedbin/blob/master/app/models/source/meta_links.rb ; NetNewsWire `Modules/RSParser/Sources/RSParser/HTML/HTMLMetadata.swift` at commit `d3db1bbd` — https://github.com/Ranchero-Software/NetNewsWire/blob/d3db1bbd62025bce0e67fe95bcbdb8f9ec68a5ba/Modules/RSParser/Sources/RSParser/HTML/HTMLMetadata.swift

Miniflux's selector:

```go
doc.Find("link[type]").Each(func(_ int, s *goquery.Selection) {
    typeAttr, _ := s.Attr("type")
    switch typeAttr {
    case "application/rss+xml":  feedFormat = parser.FormatRSS
    case "application/atom+xml": feedFormat = parser.FormatAtom
    case "application/feed+json": feedFormat = parser.FormatJSON
    case "application/json": /* skip /wp-json/ hrefs */ feedFormat = parser.FormatJSON
    default: return
    }
```

SimplePie's filter (note `text/html` in the list, and that `rel="feed"` alone is enough):

```php
if (!in_array($href, $done) && in_array('feed', $rel) || (in_array('alternate', $rel) && !in_array('stylesheet', $rel) && $link->hasAttribute('type') && in_array(strtolower($this->registry->call(Misc::class, 'parse_mime', [$link->getAttribute('type')])), ['text/html', 'application/rss+xml', 'application/atom+xml'])) && !isset($feeds[$href])) {
```

NetNewsWire's test:

```swift
static let feedTypeSuffixes = ["/rss+xml", "/atom+xml", "/json"]
guard rel == alternateRel else { return false }
// Accept feed-typed alternates AND typeless alternates — some pages advertise
// their RSS/Atom feed with <link rel="alternate" href="…"> and no type attribute.
```

### Implication for the discovery operation

Honour `application/rss+xml` and `application/atom+xml`, compared case-insensitively after stripping any `;charset=` parameter (the specs say case-insensitive; SimplePie's `parse_mime` + `strtolower`, Feedbin's `strip.downcase` and Firefox's regex all do this; Miniflux's exact match is the stricter outlier). Match `rel` as a whitespace-separated token list containing `alternate` (Feedbin's `rel~=`, Firefox, SimplePie), not as an exact string (NetNewsWire) — `rel="alternate nofollow"` is legal HTML. Do not honour `application/xml` / `text/xml` as declarations: none of the four readers does, no spec does, and the cost of a false positive (treating an arbitrary XML alternate such as a sitemap or an OpenSearch description as a Feed) is paid at preview time anyway — the proven-first flow in #39 fetches and parses whatever discovery picks, so the declaration only has to be a good bet, and the proof catches the rest. Record the other types as alternatives only if the spec wants them shown; the cheap, defensible line is "the two spec types".

## 2. Relative `href` resolution and `<base href>`

- **RSS Autodiscovery 1.0**: "The href attribute must be the feed's URL. This can be a relative URL in pages that include a base element in the header." (It recommends full URLs otherwise.) — https://www.rssboard.org/rss-autodiscovery
- **Atom drafts** (both): "The value MAY be a relative URI, and if so, clients MUST resolve it to a full URI (section 5 of [RFC3986]) using the document's base URI (section 12.4 of HTML 4 […])." HTML 4 §12.4 is the `<base>` element. — https://datatracker.ietf.org/doc/html/draft-snell-atompub-autodiscovery-00
- **WHATWG HTML §2.4.3 "Document base URLs"**: "The document base URL of a `Document` document is the URL record obtained by running these steps: If document has no descendant `base` element that has an `href` attribute, then return document's fallback base URL. Otherwise, return the frozen base URL of the first `base` element in document that has an `href` attribute, in tree order." The fallback base URL is, for an ordinary document, "document's URL" — i.e. the response URL after redirects. — https://html.spec.whatwg.org/multipage/urls-and-fetching.html#document-base-url
- **`<base>` itself** (§4.2.3): "If there are multiple `base` elements with `href` attributes, all but the first are ignored." A `base` element's frozen base URL is its `href` "parsed with document's fallback base URL" — so `<base href="/blog/">` is itself relative to the document URL, and a `data:`/`javascript:` base falls back to the document URL. Content model says `base` belongs in `head`, but the "first in tree order" rule does not care where the parser put it. — https://html.spec.whatwg.org/multipage/semantics.html#the-base-element

Readers:

- **Miniflux** honours `<base href>` only when it is absolute, and resolves everything else against the URL the user typed (not the redirect target): `getBaseURL` reads `head base` and uses it "if urllib.IsAbsoluteURL(hrefValue)"; a relative base is ignored. Its `ResolveToAbsoluteURL` forces scheme-relative `//host/feed` to `https:`. — finder.go L413–421, `internal/urllib/url.go`, commit `106cdd09`
- **NetNewsWire** has no `<base>` handling at all and resolves against `url.absoluteString` of the *requested* URL; `response.url` is never consulted, so a site that redirects `example.com` → `blog.example.com` and declares `href="/feed"` yields the wrong host. — `HTMLMetadata.absoluteURLString(from:baseURLString:)`, `FeedFinder.swift`, commit `d3db1bbd`
- **Feedbin** resolves with `join_url(response.url, link["href"])` — the post-redirect response URL; no `<base>` handling. — `app/models/source/meta_links.rb`
- **SimplePie/FreshRSS** is the closest to the Standard: `get_base()` starts from `$this->file->get_final_requested_uri()` (post-redirect), then the first `<base href>` anywhere in the DOM, itself absolutized against that URL, overrides it. One quirk: a `<link>` uses the base only if its source *line number* is greater than the `<base>` element's (`if ($this->base_location < $line)`), so a `<base>` and a `<link>` on the same line resolve against the HTTP URL. — `src/Locator.php` L191–212, L252–258, commit `18957a8d`

Implication: resolve against the final response URL (the `Retrieval` module already follows and revalidates redirects, so it knows it), then against the first `<base href>` in tree order, itself resolved against the final URL. That is the Standard's algorithm; only SimplePie gets all of it right, and it costs one attribute lookup.

## 3. Several declared feeds: what order means and how readers pick

Specs:

- **RSS Autodiscovery 1.0**: "If you decide to include more than one autodiscovery link, the first link should be the site's main feed." It also advises publishers to include only one.
- **Atom drafts**: "The order of the autodiscovery elements is significant. The first element SHOULD point to the publisher's preferred feed" and "Clients who wish to choose exactly one feed without user input SHOULD choose the one pointed to by the first autodiscovery element."
- **WHATWG HTML §4.6.6.1**: "If the user agent has the concept of a default syndication feed, the first such element (in tree order) should be used as the default." (r4111 in 2009 phrased it as a "must"; the current text is "should".)

What the biggest publisher emits: WordPress hooks `feed_links` at `wp_head` priority 2 and `feed_links_extra` at priority 3 (`wp-includes/default-filters.php` L353–354). `feed_links()` prints the posts feed (`'%1$s %2$s Feed'`) first and the comments feed (`'%1$s %2$s Comments Feed'`) second; `feed_links_extra()` then appends the contextual one — per-post comments feed on a single post, category/tag/author/search/post-type feeds on archives. So on a WordPress post the declarations read, in order: site feed, site comments feed, this post's comments feed. First-in-order is right; "first" is also the only rule that survives titles being localised. — https://github.com/WordPress/WordPress/blob/master/wp-includes/general-template.php L3455–3520, 3520–3750

Readers:

- **Miniflux** returns every declaration in document order, deduplicated by resolved absolute URL (first occurrence keeps its title). One result subscribes directly; more than one renders `choose_subscription`, a radio list of `{{ .Title }} ({{ .Type }})`, and the user picks. The API (`/v1/discover`) returns the full list and leaves the choice to the client. Pinned by `TestParseWebPageWithDuplicatedFeeds` and `TestParseWebPageWithMultipleFeeds`. — finder.go L138–183, `internal/ui/subscription_submit.go`, `internal/api/subscription_handlers.go`, commit `106cdd09`
- **NetNewsWire** collects a `Set<FeedSpecifier>` then `bestFeed(in:)` picks one by score; the local account subscribes to it without showing the list. Score, verbatim:

  ```swift
  if source == .userEntered { return 1000 } else if source == .HTMLHead { score += 50 }
  score -= (orderFound - 1) * 5
  if urlString.caseInsensitiveContains("comments") { score -= 10 }
  if urlString.caseInsensitiveContains("podcast")  { score -= 10 }
  if urlString.caseInsensitiveContains("rss")      { score += 5 }
  if urlString.hasSuffix("/index.xml")             { score += 5 }
  if urlString.hasSuffix("/feed/")                 { score += 5 }
  if urlString.hasSuffix("/feed")                  { score += 4 }
  if urlString.caseInsensitiveContains("json")     { score += 3 }
  if let title = title, title.caseInsensitiveContains("comments") { score -= 10 }
  ```

  Each later position costs 5, so the first head declaration wins unless a later one gathers more than 5 points of bonuses; "comments" in URL or title is the one strong demotion. — `Modules/FeedFinder/Sources/FeedFinder/FeedSpecifier.swift`, `Modules/Account/Sources/Account/LocalAccount/LocalAccountDelegate.swift`, commit `d3db1bbd`
- **Feedbin** fetches every `link[rel~=alternate]` in document order (`options.uniq.each … create_from_url!`), keeps those that parse, and returns the list for the user to choose from; no first-only rule. Strategy ladder: existing feed → body is XML → meta links → known patterns → body `<a>` links (first 4) → guess. — `app/models/feed_finder.rb`, `app/models/source/meta_links.rb`
- **Firefox** collected every match from `document.getElementsByTagName("link")` into the subscribe menu, in order, with no default. — `content.js` `getFeedsInfo`
- **Feedly / Inoreader** document no rule. Feedly's help: "We should be able to find the site's feed or multiple feeds from the site"; Inoreader: "you'll then be able to subscribe to feeds found on that page" — both imply a chooser. — https://docs.feedly.com/article/288-how-to-follow-a-feed-in-your-feedly-account, https://www.inoreader.com/blog/2015/02/searching-for-content-its-never-been.html
- **FreshRSS / SimplePie**: `Locator::autodiscovery()` collects every qualifying `<link>`, then `<a>`, then `<area>` in document order, *fetches each one* (up to `max_checked_feeds`, default 10) and keeps those whose response sniffs as a feed; `find()` returns `$working[0]`, the first in document order that proved itself. SimplePie exposes the rest via `get_all_discovered_feeds()`, but FreshRSS never calls it: `FreshRSS_Feed::load(loadDetails: true)` silently rewrites the stored URL to `subscribe_url()`, and the add page shows that single feed's title and description. There is no chooser; `#force_feed` on the URL skips discovery. — `src/Locator.php` L119–160, L217–274; FreshRSS `app/Models/Feed.php` L597–691, `app/Controllers/feedController.php` L86, L355–367, commit `95842d81`

Implication: "follow the first declared feed and return alternatives" (the decision already on #38) is exactly what the specs ask and what WordPress's output rewards. NetNewsWire's heuristics buy little over plain order — their main effect is demoting a comments feed that a publisher put first, which the specs say not to do. Keep order; keep titles so the alternatives list is legible; dedupe by resolved URL as Miniflux does.

## 4. `<link>` elements outside `<head>`

What the Standard says, in three parts:

- **Conformance**: `link` is allowed in body only when "it has an `itemprop` attribute, or has a `rel` attribute that contains only keywords that are body-ok". "The body-ok keywords are `dns-prefetch`, `modulepreload`, `pingback`, `preconnect`, `prefetch`, `preload`, and `stylesheet`." `alternate` is not among them, so a feed declaration in `<body>` is a document conformance error. — https://html.spec.whatwg.org/multipage/semantics.html#the-link-element, https://html.spec.whatwg.org/multipage/links.html#body-ok
- **Parsing** (§13.2.6.4): the tree builder never drops a `<link>`. In the "in body" insertion mode a start tag named `base`, `link`, `meta`, … is processed "using the rules for the 'in head' insertion mode", which inserts the element where it stands — no parse error. In the "after head" insertion mode (between `</head>` and `<body>`) the same tags are a "Parse error", but the parser pushes the head element back on the stack and inserts the `link` *into `<head>`*. So a sloppy `</head><link …><body>` still lands in head, and a `<link>` in body becomes a body child. — https://html.spec.whatwg.org/multipage/parsing.html#parsing-main-inbody, #the-after-head-insertion-mode
- **Autodiscovery**: the §4.6.6.1 rule quoted above counts "all `link` elements in the document", not in `head`.

The Atom drafts disagree with the Standard on placement: an autodiscovery element "MAY appear within the `<head>` element […] but it MUST NOT appear within the `<body>`". The RSS Board spec: "The link must be placed within a web page's head element". Those are publisher rules; neither tells a client to ignore a body `<link>`.

Readers:

- **Miniflux**: whole document — `doc.Find("link[type]")` has no `head` prefix (its canonical and base lookups *are* head-scoped: `head link[rel='canonical' i]`, `head base`). — finder.go L144, L395, L415
- **NetNewsWire**: stops at the opening `<body>` tag — "except for YouTube URLs — which are known to put feed-link tags in the body"; a document with no `<body>` tag is scanned to the end. — `HTMLMetadataParser.swift`, commit `d3db1bbd`
- **Feedbin**: whole DOM — `document.css("link[rel~=alternate]")`, no `head` scope. **Firefox**: whole DOM — `document.getElementsByTagName("link")`.
- **SimplePie/FreshRSS**: whole DOM — `search_elements_by_tag` runs `getElementsByTagName('link')` on a `loadHTML($body)` document; the only `(//head)[1]` query in the file is for `hub`/`self` rels, not discovery. — `src/Locator.php` L78–87, L217–230, L349

Implication: scan the whole received document with an HTML parser (the body case is a conformance error on the publisher's side, not a reason for the reader to miss a feed, and YouTube is a real instance). The cost is nil once the document is parsed.

## 5. How far to read, and a byte cap for discovery

Two honest answers:

- **Parser-faithful**: you are certain only at end of document. A `<link>` may appear at any depth (§4 above), and nothing in HTML bounds the size of `<head>`.
- **Spec-faithful**: every autodiscovery spec puts the declaration in `<head>`, and `<head>` ends where the first `<body>` (or first flow content) begins. The Web Almanac 2024 measures the median HTML document at **18 KB** on both desktop and mobile. — https://almanac.httparchive.org/en/2024/page-weight

What readers do:

| Reader | Page cap | Behaviour at the cap |
|---|---|---|
| Miniflux | `HTTP_CLIENT_MAX_BODY_SIZE`, default **15 MiB** of *decoded* body ("Maximum body size for HTTP requests in Mebibyte (MiB). Default is 15 MiB."), shared with feed fetches | hard failure via `http.MaxBytesReader` → `error.http_response_too_large`; nothing is scanned |
| NetNewsWire | none — plain `URLSession.dataTask` | n/a (a 128-byte *minimum* applies to feed sniffing) |
| Feedbin (feedkit) | `MAX_SIZE = 10 * 1024 * 1024`, every download | silently truncates: `break if size > MAX_SIZE` in `download_to_file`, then parses what it has |
| feedsearch-crawler (Python library) | `DEFAULT_MAX_CONTENT_LENGTH = 1024 * 1024 * 10` | fails: `ContentLengthError` on the `Content-Length` header and again while streaming, surfaced as status 413 |
| Firefox ESR 60 | none — it scanned the live DOM of whatever the browser loaded | n/a |
| Feedly, Inoreader | nothing documented | |
| FreshRSS / SimplePie | none — `File::curlInit()` sets no `CURLOPT_MAXFILESIZE`; the fsockopen path reads to EOF; FreshRSS's `limits` config has timeouts and counts, no byte limit | n/a (only `CURLOPT_TIMEOUT`, FreshRSS default 20 s) |

Sources: Miniflux `internal/config/options.go` L256–263 and L775–777, `internal/reader/fetcher/response_handler.go` L133–173, https://miniflux.app/docs/configuration.html ; NetNewsWire `Modules/RSWeb/Sources/RSWeb/Downloader.swift` ; SimplePie `src/File.php` L204–207, L449–460 ; FreshRSS `config.default.php` L107–164, `app/Models/SimplePieCustom.php` ; feedkit `lib/feedkit/request.rb` — https://github.com/feedbin/feedkit/blob/master/lib/feedkit/request.rb ; feedsearch-crawler `src/feedsearch_crawler/crawler/crawler.py`, `downloader.py` — https://github.com/DBeath/feedsearch-crawler.

Implication for the `discovery` Retrieval profile (ADR 0005; today `feed` is 20 MiB, `reader` and `image` 5 MiB — `src/server/upstream/retrieval.ts`): **1 MiB** is a defensible ceiling. It is 50× the median page and well past any conformant `<head>`; the declarations that matter sit in the first few KB of a WordPress page (`wp_head` priority 2). Two details matter more than the number: (a) on reaching the cap, *stop reading and scan what arrived* rather than failing as Miniflux and feedsearch do — Feedbin's `break if size > MAX_SIZE` is the precedent, and HTML parsers are built to cope with truncated input; a page whose `<head>` alone exceeds 1 MiB is not a page a Feed reader will rescue; (b) the cap is on decoded bytes (gzip/br), as Miniflux and this repo's `Retrieval` already count them. If the body is a feed document rather than HTML (Miniflux and NetNewsWire both sniff for this first), discovery should hand it to the feed path instead of scanning for `<link>`.

## 6. JSON Feed, for the out-of-scope record

JSON Feed 1.1, "Discovery": `<link rel="alternate" title="My Feed" type="application/feed+json" href="https://example.org/feed.json" />` — "This is the same as the feed discovery mechanism used for RSS and Atom." Under "Suggestions for Publishers": "JSON Feed files should be served using the MIME type `application/feed+json`. Many feeds will still use the more general MIME type `application/json`", and readers are told to accept both. — https://www.jsonfeed.org/version/1.1/

Reader support: Miniflux and Feedbin accept both `application/feed+json` and `application/json` (Miniflux skips `application/json` hrefs containing `/wp-json/`, the WordPress REST API). NetNewsWire accepts `…/json` but, by its suffix rule, not `application/feed+json` (a bug in the reader, not the spec). For simple-rss: report nothing for these types in v1 (#38 decision), but the type string to recognise later is `application/feed+json`, with `application/json` as the legacy alias.

## Readers: per-reader notes

### Miniflux (Go) — commit `106cdd09`, 2026-08-11; release 2.3.3

Pipeline in `FindSubscriptions` is a short-circuit ladder: (1) body is already a feed → return it; (2) `<link rel=canonical>` rewrites the site URL; (3) YouTube; (4) GitHub; (5) `<link type=…>` scan; (6) RSS-Bridge if configured; (7) well-known paths (`atom.xml`, `feed.atom`, `feed.xml`, `feed/`, `index.rss`, `index.xml`, `rss.xml`, `rss/`, `rss/feed.xml`, tried at the site root and then the current directory, redirects refused, body not parsed — a 200 is taken on status alone). Details for each question are in §1–5. — https://github.com/miniflux/v2/blob/106cdd09e1557222303f3ed1376e1dadf0638621/internal/reader/subscription/finder.go

### NetNewsWire (Swift) — commit `d3db1bbd`, read 2026-08-22

`FeedFinder.performFind`: hard-coded site overrides; download; 404 on `micro.blog` → append `.json`; if the bytes sniff as a feed, return it; if they do not sniff as HTML, fail; otherwise `<link rel=alternate>` before `<body>` are trusted *without download* and returned at once. Only if there are none does it collect `<a href>` links whose URL contains `feed`, `xml`, `rss`, `atom` or `json` (with "buzzfeed" masked), and only if those are empty too does it try `feed/` and `index.xml` relative to the page; body candidates are downloaded and kept only if they sniff as a feed. Content-Type is never read; HTML detection is byte sniffing. — https://github.com/Ranchero-Software/NetNewsWire/blob/d3db1bbd62025bce0e67fe95bcbdb8f9ec68a5ba/Modules/FeedFinder/Sources/FeedFinder/FeedFinder.swift, `HTMLFeedFinder.swift`, `FeedSpecifier.swift`; `Modules/RSParser/Sources/RSParser/HTML/HTMLMetadataParser.swift`, `HTMLMetadata.swift`

### FreshRSS / SimplePie (PHP) — SimplePie `master` @ `18957a8d` (1.9.0); FreshRSS `edge` @ `95842d81`

`Locator::find()`: if the page itself sniffs as a feed, return it; if a remote document does not sniff as `text/html`, give up; otherwise try, in strict priority, AUTODISCOVERY (`<link>`/`<a>`/`<area>` with the rel/type filter above), then LOCAL_EXTENSION (same-host `<a href>` ending `.rss`/`.rdf`/`.atom`/`.xml`), LOCAL_BODY (same-host `<a href>` matching `/(feed|rss|rdf|atom|xml)/i`), then the REMOTE_ variants of both. Every candidate is fetched and sniffed before it counts; default `LOCATOR_ALL`, `max_checked_feeds = 10`. FreshRSS runs this only on the add path and stores whatever single URL came back. — https://github.com/simplepie/simplepie/blob/18957a8d1ed93bc4cd502454287851ad3e172229/src/Locator.php, https://github.com/FreshRSS/FreshRSS/blob/95842d81c1b8ab673389544f072559aeb8cd7591/app/Models/Feed.php

### Feedbin (Ruby) — `feedbin/feedbin` and `feedbin/feedkit` at `master`, read 2026-08-22

`FeedFinder.feeds` runs the ladder in §3, each rung only if the previous found nothing, then `uniq` by id. `Source::MetaLinks` is the autodiscovery rung (types, `rel~=`, whole-DOM, response-URL join as above); `Source::BodyLinks` scans `<a href>` for `feed`/`xml`/`rss`/`atom` and keeps the first four. Downloads go through `Feedkit::Request.download(…, block_ssrf: true)` with `HTTP.timeout(connect: 5, write: 5, read: 30)` and the 10 MiB truncating cap. — https://github.com/feedbin/feedbin/blob/master/app/models/feed_finder.rb, https://github.com/feedbin/feedbin/blob/master/app/models/source/meta_links.rb, https://github.com/feedbin/feedkit/blob/master/lib/feedkit/request.rb

### Firefox ESR 60 (historical, the last feed-preview series)

`Feeds.isValidFeed` and `content.js` `getFeedsInfo`, quoted in §1. Whole-document scan, every match listed, no byte cap, no default. Worth keeping as the one browser-side reference: it is the behaviour the HTML Standard's §4.6.6.1 text was written to describe. — https://hg-edge.mozilla.org/releases/mozilla-esr60/raw-file/tip/browser/modules/Feeds.jsm, https://hg-edge.mozilla.org/releases/mozilla-esr60/raw-file/tip/browser/base/content/content.js

### Feedly and Inoreader (hosted; docs only)

Neither publishes discovery rules. Feedly's only publisher guidance (2015, on its engineering blog): "By adding an "application/rss+xml" alternate metadata to the header of your HTML page, you can make it easier for users to discover your feeds" — https://devhd.wordpress.com/2015/07/31/10-ways-to-optimize-your-feed-for-feedly/. Its help centre tells users to search the page source for ".rss", ".xml" or ".atom" when discovery fails — https://docs.feedly.com/article/288-how-to-follow-a-feed-in-your-feedly-account. Inoreader's IFTTT action says the input "should be a valid RSS feed or an HTML page containing a meta link to the feed" — https://ifttt.com/inoreader/actions/subscribe — and its fetcher page states "Inoreader only fetches direct RSS feed URLs provided by our users" — https://www.inoreader.com/feed-fetcher. The old Feedly `/v3/search/feeds` endpoint is gone from the developer docs.

## Unreachable

- https://developers.feedly.com/v3/search/ (404; the historical feed-search endpoint) and its web.archive.org copy — the fetch tool refuses web.archive.org.
- https://feedly.com/i/publisher — returns a loading-error page.
- https://intercom.help/inoreader/en/ and https://www.inoreader.com/help — 404; Inoreader has no help centre beyond the blog and a ticket portal.
- https://raw.githubusercontent.com/mozilla/gecko-dev/FIREFOX_63_0_RELEASE/… — tag does not exist; hg.mozilla.org ESR 60 was used instead.
- No corpus measurement of `<link type>` values for feeds was found (the Web Almanac markup chapters count `rel` values only); the "in the wild" claim in §1 rests on publisher and reader source, not on a crawl.
