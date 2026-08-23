# Simple RSS

The domain of a calm, single-user RSS reader that collects recent entries without turning reading into inbox management.

## Language

**User**:
The single person who controls an installation and accesses it from their devices.
_Avoid_: Owner, account, tenant

**Setup Secret**:
The random value the deployment is configured with, which lets the first visitor become the User. It is spent once: claiming the installation disables setup permanently.
_Avoid_: Invite code, admin token, registration key

**Session**:
One of the User's signed-in devices, held as an opaque token whose hash alone is stored. Sessions are independent, so a phone and a laptop do not displace each other.
_Avoid_: Login, token, credential

**Feed**:
An external RSS or Atom source that publishes entries.
_Avoid_: Channel, source

**Subscription**:
The User's decision to include a Feed in their Digest, together with preferences specific to that Feed.
_Avoid_: Feed list, followed feed

**Custom Title**:
The User's Subscription-held name for a Feed. While set, it is the Feed's name everywhere the Feed is named, including OPML export and search; clearing it returns the Feed's reported title. OPML Import never creates one.
_Avoid_: Nickname, rename, alias

**Custom Description**:
The User's Subscription-held description for a Feed, shown in place of the Feed Description while set; clearing it returns the Feed Description.
_Avoid_: Note, annotation

**OPML Import**:
Recording the Subscriptions listed in an OPML file without contacting any Feed; whether each Feed answers is Feed Availability's story.
_Avoid_: Feed migration, bulk subscribe

**Polling Interval**:
The User-selected preset controlling how often a Subscription becomes eligible to be checked for updates.
_Avoid_: Polling rate, exact schedule

**Feed Availability**:
A calm summary of a Subscription's recent retrieval outcome, without implying that a failing Feed should be removed. A Subscription recorded by OPML Import that has never been retrieved is unchecked.
_Avoid_: Feed health, broken Feed, pending feed

**Feed Item**:
An entry published by a Feed, represented by its available title, link, summary, publication time, and image URL.
_Avoid_: Post, article

**Feed Home Page**:
The site a Feed declares as its own, read from the Feed document and absent when the Feed names only its own URL. It supplies the host shown beside a Feed and the link behind it, so the Feeds list names the publisher rather than whichever host serves the XML.
_Avoid_: Site URL, website, channel link

**Feed Description**:
The description a Feed reports about itself in the Feed document, refreshed on each successful retrieval like the Feed's reported title.
_Avoid_: Subtitle, blurb, about text

**Feed Window**:
The set of Feed Items exposed by a Feed during its latest successful retrieval.
_Avoid_: RSS fetch window, current batch

**Declared Feed**:
A Feed a web page names in its own markup, so that pasting the page finds the Feed. A page may declare several; the first in the page is its default.
_Avoid_: Alternative feed, autodiscovered feed, link-rel

**Quiet Merge**:
Folding a Subscription into the Feed its retrieval turned out to be, when two addresses hide one Feed. Nothing retained is deleted and the User is never asked, so a merged duplicate that had items goes dormant like any unsubscribed Feed.
_Avoid_: Deduplication, feed collapse, alias fixup

**Cadence**:
A Feed's publishing rhythm, drawn from retained Feed Items as per-day counts in the installation timezone and rendered at four ink levels — a strip on the Feeds list, a 26-week grid on an opened Feed. The stat line's "posts" is display copy fixed by the design system; the domain term remains Feed Item.
_Avoid_: Activity graph, contribution graph, frequency chart

**Digest**:
The time-grouped collection of Feed Items from the User's Subscriptions.
_Avoid_: Inbox, reading list

**Library**:
The User's explicitly saved Feed Items.
_Avoid_: Reading list, bookmarks

**Retention**:
The rule keeping ordinary history bounded: an unsaved Feed Item is removed 90 days after it was last observed in a Feed Window, and an unsubscribed Feed's unsaved items are removed at the next sweep. Library membership always survives Retention, and a Feed with saves keeps the metadata behind their attribution.
_Avoid_: Expiry, archiving, garbage collection

**Reader View**:
A temporary, distraction-reduced rendering derived from a Feed Item's original webpage.
_Avoid_: Stored article, cached content
