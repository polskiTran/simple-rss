# Prove a Feed inside the subscribe request; record an OPML Import before its first retrieval

Subscribe retrieves and parses the pasted address before it writes anything, and answers 201 with a Subscription that is already `available`, its items already in the Digest. An address that does not prove to be a Feed answers 4xx with the reason and leaves no row. OPML Import keeps the record-first model of ADR 0007. Every entry is recorded without contacting its Feed, begins unchecked, and is retrieved by the scheduler on the ordinary poll path, so `unchecked` survives as a Feed Availability state that only OPML Import produces. `docs/ARCHITECTURE.md` describes both paths as they run.

```text
subscribe     paste ──▶ [ publisher ] ──▶ subscribe to <title>? ──▶ [ publisher ] ──▶ write ──▶ 201, available
              a refusal at either request ──▶ 4xx, and no row is written

OPML Import   file ──▶ write ──▶ 200, unchecked ──▶ scheduler wakes ──▶ [ publisher ] ──▶ available, or failing and retried
```

The publisher answers before the write on one path and after it on the other. Everything below follows from that.

## One URL a User is watching, against a list nobody is watching

Subscribe is one URL the User is looking at, pasted a moment ago. That URL may be a page rather than a Feed, and it may be wrong. The honest answer is the Feed itself, its title, its host, and its last five items, with the question `subscribe to <title>?` asked before anything is written. The honest failure is one sentence under the field while the User is still there. Proving costs one request. Measured against a 100 KB Feed from the sandbox, retrieval takes 82 ms and parsing 41 ms, and a subscribe reaches `available` in 274 ms on an idle installation.

What made a new Subscription look stuck was never that cost. It was the scheduler state that `unchecked` hid from the User. A nudge that arrived while the scheduler was working through a batch of up to 25 due Feeds waited for the whole batch. A `busy` answer from the `feed` operation's concurrency budget was recorded as a full Polling Interval's deferral. A first failure backed off two hours.

An OPML Import is the opposite case. Its URLs are Feeds by construction, because another reader already retrieved them, and nobody is looking at any one of them. The reader once proved each of them inside the request. That held one HTTP request open while 136 Feeds answered, and it made a Subscription's existence depend on every remote server answering within one attempt. A Feed that failed once left no row, so nothing could ever retry it. Recording first makes the existing backoff and Feed Availability machinery the way a failed Feed gets retried, at the cost of admitting Feeds nobody has ever reached. That is the right trade for a list and the wrong one for a single URL.

## Two consequences of ADR 0007 narrow to the import path

The first is the quiet merge at retrieval. A poll that resolves onto a URL another Feed already owns folds the later Subscription into that Feed and deletes nothing retained. The merge stays on the poll path, where OPML Import is what makes it ordinary, since it alone records a URL before seeing where it resolves. Subscribe learns the resolved URL before it writes and settles duplicates itself, by the rule `docs/ARCHITECTURE.md` states. The preview never refuses a duplicate, because saying a Feed is already subscribed and offering to open it is the better answer. The second consequence, a never-succeeded Feed that retries forever on the ordinary backoff, still holds, but only OPML Import can make such a Feed.

## What the scheduler and the retrieval boundary change

A deferral, meaning a `busy` answer or a cancelled attempt, is rescheduled a wake interval out rather than a full Polling Interval, since a deferral says nothing about the Feed. Nothing else about the row changes. Nudge coalescing stays as it is, because an import's nudge that joins a running batch and earns one more is right for bulk work. Subscribe no longer goes through the scheduler at all.

Preview and subscribe run under one Retrieval operation of their own, `preview` (ADR 0005), which accepts a page beside a Feed and holds a concurrency budget separate from `feed`, so a running OPML Import can neither refuse nor starve the dialog. A pasted page is read under the Feed ceiling and refused past it rather than truncated at a smaller one. One operation that accepts both content types keeps a pasted address to a single request whatever it turns out to be, and the 15 s budget, spent across the page and the Declared Feed it leads to, is what bounds the path.

## Three costs, and the alternative rejected

A subscribe makes two publisher requests, the preview and then the subscribe. A pasted page makes three. Nothing caches the preview, because a cache would be a second place a Feed's state lives, and the second request is unconditional. No validators are held between the two, and the subscribe needs a body to write a Feed Window from. A subscribe then takes as long as the publisher takes, under a 15 s deadline, where it used to return in 17 ms. And the fallback that ADR 0007 amounted to, add the URL anyway and let the first check decide, is gone for subscribe. A URL that does not prove to be a Feed is not a Subscription.

The rejected alternative is one record-first path for both callers with a faster scheduler behind it. The scheduler's latency can be trimmed, and this decision trims it, but a record-first subscribe still cannot ask `subscribe to <title>?` before it commits. It cannot tell the User which of a page's Declared Feeds they are about to add. And it still turns a mistyped URL into a row that retries forever.
