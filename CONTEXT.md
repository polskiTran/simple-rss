# Simple RSS

The domain of a calm, single-owner RSS reader that collects recent entries without turning reading into inbox management.

## Language

**Owner**:
The single person who controls an installation and accesses it from their devices.
_Avoid_: User, account, tenant

**Setup Secret**:
The random value the deployment is configured with, which lets the first visitor become the Owner. It is spent once: claiming the installation disables setup permanently.
_Avoid_: Invite code, admin token, registration key

**Session**:
One of the Owner's signed-in devices, held as an opaque token whose hash alone is stored. Sessions are independent, so a phone and a laptop do not displace each other.
_Avoid_: Login, token, credential

**Feed**:
An external RSS or Atom source that publishes entries.
_Avoid_: Channel, source

**Subscription**:
The Owner's decision to include a Feed in their Digest, together with preferences specific to that Feed.
_Avoid_: Feed list, followed feed

**Polling Interval**:
The Owner-selected preset controlling how often a Subscription becomes eligible to be checked for updates.
_Avoid_: Polling rate, exact schedule

**Feed Availability**:
A calm summary of a Subscription's recent retrieval outcome, without implying that a failing Feed should be removed.
_Avoid_: Feed health, broken Feed

**Feed Item**:
An entry published by a Feed, represented by its available title, link, summary, publication time, and image URL.
_Avoid_: Post, article

**Feed Window**:
The set of Feed Items exposed by a Feed during its latest successful retrieval.
_Avoid_: RSS fetch window, current batch

**Cadence**:
A Feed's publishing rhythm, drawn from retained Feed Items as per-day counts in the installation timezone and rendered at four ink levels — a strip on the Feeds list, a 26-week grid on an opened Feed. The stat line's "posts" is display copy fixed by the design system; the domain term remains Feed Item.
_Avoid_: Activity graph, contribution graph, frequency chart

**Digest**:
The time-grouped collection of Feed Items from the Owner's Subscriptions.
_Avoid_: Inbox, reading list

**Library**:
The Owner's explicitly saved Feed Items.
_Avoid_: Reading list, bookmarks

**Reader View**:
A temporary, distraction-reduced rendering derived from a Feed Item's original webpage.
_Avoid_: Stored article, cached content
