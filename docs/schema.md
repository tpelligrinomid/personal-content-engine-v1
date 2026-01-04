# Database Schema

This document is the source of truth for the Supabase database schema.

## Overview

Schema changes are made manually in Supabase and documented here immediately. Each change should also have a corresponding SQL file in `db/migrations_manual/`.

**Data Flow:**
```
Trend Sources → Documents ──┐
                            ├→ Extractions → Asset Inputs → Assets
Source Materials ───────────┘
```

---

## Enums

### `trend_source_status`
- `active` - Source is being crawled
- `paused` - Temporarily disabled
- `blocked` - Permanently disabled

### `crawl_method`
- `rss` - RSS feed
- `sitemap` - Sitemap crawl
- `html` - HTML scraping
- `api` - API integration
- `manual` - Manually added

### `source_material_type`
- `trend` - Imported trend/link
- `meeting` - Meeting transcript
- `voice_note` - Voice note transcript
- `manual_note` - Manually written note

### `document_status`
- `fetched` - Retrieved, not yet parsed
- `parsed` - Successfully processed
- `failed` - Processing failed
- `discarded` - Marked as not useful

### `asset_type`
- `newsletter`
- `blog_post`
- `linkedin_post`
- `twitter_post`

### `asset_status`
- `draft` - Initial generation
- `ready` - Reviewed, ready to publish
- `scheduled` - Queued for publishing
- `published` - Live
- `archived` - No longer active

---

## Tables

### `trend_sources`

Registry of web sources to crawl/monitor.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | uuid | no | Primary key |
| `name` | text | no | Display name |
| `domain` | text | yes | Base domain |
| `feed_url` | text | yes | RSS feed URL |
| `sitemap_url` | text | yes | Sitemap URL |
| `crawl_method` | crawl_method | no | How to fetch (default: manual) |
| `tier` | int | no | 1=trusted, 2=candidate, 3=blocked |
| `status` | trend_source_status | no | active/paused/blocked |
| `trust_score` | numeric(3,2) | yes | 0.00-1.00 trust rating |
| `notes` | text | yes | Internal notes |
| `created_at` | timestamptz | no | Row created |
| `updated_at` | timestamptz | no | Row updated (auto) |

---

### `documents`

Scraped articles/pages from trend sources.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | uuid | no | Primary key |
| `trend_source_id` | uuid | yes | FK to trend_sources |
| `url` | text | no | Original URL (unique) |
| `canonical_url` | text | yes | Canonical URL if different |
| `title` | text | yes | Page/article title |
| `author` | text | yes | Author if available |
| `published_at` | timestamptz | yes | Original publish date |
| `fetched_at` | timestamptz | no | When we fetched it |
| `raw_text` | text | yes | Extracted text content |
| `dedupe_hash` | text | yes | Hash for deduplication |
| `status` | document_status | no | Processing status |
| `created_at` | timestamptz | no | Row created |

**Indexes:** trend_source_id, status, published_at, dedupe_hash

---

### `source_materials`

Internal inputs: meeting transcripts, voice notes, manual notes.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | uuid | no | Primary key |
| `type` | source_material_type | no | trend/meeting/voice_note/manual_note |
| `title` | text | yes | Optional title |
| `content` | text | no | Full text content |
| `source_url` | text | yes | Reference URL if applicable |
| `occurred_at` | timestamptz | yes | When it happened (e.g., meeting time) |
| `created_at` | timestamptz | no | Row created |

**Indexes:** type, occurred_at

---

### `extractions`

LLM-extracted summaries and key points from source materials and documents.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | uuid | no | Primary key |
| `source_material_id` | uuid | yes | FK to source_materials (cascade delete) |
| `document_id` | uuid | yes | FK to documents (cascade delete) |
| `summary` | text | yes | Condensed summary of the content |
| `key_points` | text[] | yes | Array of key points/bullets |
| `topics` | text[] | yes | Extracted topics/themes |
| `model` | text | yes | Model used for extraction (e.g., claude-sonnet-4-20250514) |
| `created_at` | timestamptz | no | Row created |

**Constraint:** At least one of source_material_id or document_id must be set.

**Indexes:** source_material_id, document_id

---

### `tags`

Normalized tags for filtering and reporting.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | uuid | no | Primary key |
| `name` | text | no | Tag name (unique) |
| `created_at` | timestamptz | no | Row created |

---

### `assets`

Generated content: newsletters, blog posts, social posts.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | uuid | no | Primary key |
| `type` | asset_type | no | newsletter/blog_post/linkedin_post/twitter_post |
| `title` | text | yes | Asset title |
| `content` | text | no | Generated content |
| `status` | asset_status | no | Workflow status (default: draft) |
| `publish_date` | timestamptz | yes | Scheduled/actual publish date |
| `published_url` | text | yes | URL where published |
| `created_at` | timestamptz | no | Row created |
| `updated_at` | timestamptz | no | Row updated (auto) |

**Indexes:** type, status, publish_date

---

### `asset_tags`

Many-to-many join: assets to tags.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `asset_id` | uuid | no | FK to assets (cascade delete) |
| `tag_id` | uuid | no | FK to tags (cascade delete) |

**Primary key:** (asset_id, tag_id)

---

### `asset_inputs`

Provenance: tracks which documents/source_materials contributed to each asset.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | uuid | no | Primary key |
| `asset_id` | uuid | no | FK to assets (cascade delete) |
| `document_id` | uuid | yes | FK to documents |
| `source_material_id` | uuid | yes | FK to source_materials |
| `note` | text | yes | Why this input was included |
| `created_at` | timestamptz | no | Row created |

**Constraint:** At least one of document_id or source_material_id must be set.

**Indexes:** asset_id, document_id, source_material_id

---

## Triggers

### `update_updated_at()`

Automatically updates `updated_at` on row modification for:
- `trend_sources`
- `assets`

---

## Change Log

| Date | Change | Migration File |
|------|--------|----------------|
| 2025-01-03 | Initial schema: 7 tables, 6 enums | `20250103_01_initial_schema.sql` |
| 2025-01-04 | Add extractions table for LLM summaries | `20250104_01_add_extractions_table.sql` |
