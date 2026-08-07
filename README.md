# simple rss (WIP)
a simple rss reader 

## Motivation
I love RSS, i think it's a great way to keep up with your favorite blogs and news aggregators. One thing i dont love about RSS reader app is that they all mature into this "optimized" UI/UX that i dont really love. That's why i'm building simple-rss - an opinionated extreme minimalist RSS reader app as a way to practice building multi platform (web/mobile) application and it's just fun to build stuff. 

## Philosophy
Having unread and read state is an easy way for your RSS reader app to feel like a gmail inbox and create a graveyard of unread post if you add a firehose feed like HackerNews -> Post recency (i.e. "4h ago" "1 week ago") is a better state that is easily computed and perceived by users.

simple-rss store everything in a local db

simple-rss aims to be distraction less, minimal and less overwhelming RSS reader.

## Features
Digest: homepage - serving feed item grouped by date 
Reader: clicking a feed item shows you the parsed markdown content of the post and also a to original (there're so many well designed blogs out there)
Library: allow for users to save posts to library
Search: global search (feed title, item title, summary)
Polling: per feed polling rate 

## Tech stack
- pnpm workspace 

## v1
- app/core and app/mobile

## v2
- app/mobile
- tag post
- pruning
- feed auto discovery
