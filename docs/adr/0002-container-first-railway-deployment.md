# Use a container-first Railway deployment

Package the static client, API, in-process feed scheduler, server-side Reader View extraction, and SQLite access as one portable Docker service, with Railway and one persistent volume as the documented managed deployment. This costs slightly more than Fly.io but minimizes setup and operations; the single-instance and brief deployment-downtime constraints are acceptable for a single-owner reader, while the generic image preserves the option to move to another container host.
