# Use application-owned single-user authentication

Simple RSS owns a password-based login rather than requiring Cloudflare Access or an external identity provider. A one-time setup secret establishes the User, passwords use Argon2id, opaque sessions live in SQLite, and login attempts are rate-limited; this adds a small security-sensitive module but keeps the Docker deployment portable and self-contained without introducing registration, recovery email, OAuth, roles, or multi-user accounts.
