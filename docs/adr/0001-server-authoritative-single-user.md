# Use a server-authoritative, single-user model

Each self-hosted installation serves one User, and the server is authoritative for Subscriptions, Feed Items, Library membership, and preferences. Clients may cache views but will not replicate independent local databases; this keeps multi-device access predictable and avoids introducing conflict resolution into an intentionally simple reader.
