# Feeds list

Feeds groups Subscriptions by rhythm. Each is a Feed row: name, host and a 30-day Cadence strip, in two columns where each row gets 520px.

## Sub-features

- `feeds-rows` shows the name, host and strip without squeezing the name.
- `feeds-columns` uses two columns from about 1145px, one below.
- `feeds-host` keeps ↗ at the end of a wrapped host, and opens a new tab.
- `feeds-groups` groups by rhythm with jumps and Show more.
- `feeds-note` shows availability and Retry on a failing Feed.

## How to get to it (user POV)

- Choose Feeds in the header.
- Choose a rhythm chip to jump to its group.

## Driving it with verify and spec

Preconditions:

- The baseline holds. Subscribing paths boot their own service.

- **Render.** Run `verify sweep --tag feeds --screens feeds`. No findings at any target.
- **Columns.** Open `feeds/metrics.json`, then look at `feeds/d1180/feeds.png` for two columns and `feeds/d1025/feeds.png` for one.
- **Real path.** Run `spec tests/browser/subscriptions.spec.ts -g "lists the Feed with its Cadence"`. It passes.
- **Phone.** Run `spec tests/browser/subscriptions.spec.ts -g "keeps the same structure on the phone"`. It passes.
- **Proof.** Look at `feeds/p320/feeds.png` for a strip beside a short host and under a long one.

## Gotchas

- A very long host can leave ↗ alone on a line. Only worst-case data shows this.
- `northwind-industries-holdings.example.com` as a name is an address, so a break inside it is not a finding.
- On a phone the strip draws 14 days, not 30.
