# Personal Content Engine API Documentation

## Base URL
```
https://personal-content-engine-v1.onrender.com
```

## Initial Setup (Admin Bootstrap)

Before using the system, you must set up the first admin user:

### 1. Add your email to the allowlist (via Supabase SQL Editor)
```sql
INSERT INTO allowed_emails (email) VALUES ('your@gmail.com');
```

### 2. Sign in via the frontend
Use the Google OAuth sign-in button. This creates your user in Supabase Auth.

### 3. Make yourself an admin (via Supabase SQL Editor)
```sql
-- Find your user_id
SELECT id, email FROM auth.users;

-- Set yourself as admin
UPDATE user_settings SET role = 'admin' WHERE user_id = 'YOUR_USER_ID';
```

### 4. Invite other users
Once you're an admin, use the `/api/allowed-emails` endpoint to add other users:
```javascript
await fetch('/api/allowed-emails', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ email: 'friend@gmail.com' })
});
```

---

## Authentication

All API endpoints (except `/health` and `/`) require authentication via Supabase JWT token.

**Header Format:**
```
Authorization: Bearer <supabase_access_token>
```

**How to get a token:**
1. User signs in via Supabase Auth (Google OAuth)
2. Supabase returns an `access_token` in the session
3. Include this token in the Authorization header

**Example:**
```bash
curl -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  https://personal-content-engine-v1.onrender.com/api/stats
```

**Unauthorized Response (401):**
```json
{
  "success": false,
  "error": "Missing Authorization header"
}
```

### Email Allowlist (Invite-Only Access)

This system uses an **invite-only** access model. Users must be pre-approved before they can access the API.

**How it works:**
1. Admin adds a user's email to the `allowed_emails` table
2. User signs in with Google OAuth (their Google account must use that email)
3. Backend verifies the email is in the allowlist before granting access
4. If not on the list, user receives: `"Email not authorized. Contact an administrator for access."`

**Frontend implementation:**
```javascript
// Sign in with Google
const { data, error } = await supabase.auth.signInWithOAuth({
  provider: 'google'
});

// After sign-in, use the session token for API calls
const session = await supabase.auth.getSession();
const token = session.data.session?.access_token;

fetch('/api/stats', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
```

**Note:** Even if a user successfully authenticates with Google, they will be rejected by the API if their email is not in the allowlist.

---

## Multi-User Architecture

The Personal Content Engine supports multiple users with complete data isolation:

- Each user has their own trend sources, documents, assets, and content
- No data is shared between users
- Users can configure their own crawl schedules and content preferences
- **Roles:** `admin` (can manage users) or `user` (standard access)

---

## Overview

The Personal Content Engine is a backend system that:
1. Ingests content from meetings (Fireflies), voice notes, and web articles
2. Extracts key insights using AI
3. Generates content (newsletters, blog posts, LinkedIn posts, Twitter posts)

---

## Endpoints

### User Settings

#### GET /api/settings
Get current user's settings.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "user_id": "uuid",
    "role": "user",
    "crawl_enabled": true,
    "crawl_schedule": "daily",
    "generation_enabled": true,
    "generation_schedule": "weekly_sunday",
    "generation_time": "08:00",
    "content_formats": ["linkedin_post"],
    "timezone": "America/New_York",
    "last_crawl_at": "2026-01-04T10:00:00Z",
    "last_generation_at": "2026-01-01T08:00:00Z",
    "created_at": "2026-01-01T00:00:00Z",
    "updated_at": "2026-01-04T10:00:00Z"
  }
}
```

#### PATCH /api/settings
Update current user's settings.

**Request Body:**
```json
{
  "crawl_enabled": true,
  "crawl_schedule": "twice_daily",
  "generation_enabled": true,
  "generation_schedule": "weekly_monday",
  "generation_time": "09:00",
  "content_formats": ["linkedin_post", "newsletter"],
  "timezone": "America/Los_Angeles"
}
```

All fields are optional. Only include fields you want to update.

**Valid values:**
- `crawl_schedule`: `manual`, `every_6_hours`, `twice_daily`, `daily`
- `generation_schedule`: `manual`, `daily`, `weekly_sunday`, `weekly_monday`
- `content_formats`: array of `linkedin_post`, `linkedin_pov`, `twitter_post`, `twitter_thread`, `blog_post`, `newsletter`

**Note:** Users cannot change their own `role`. Only admins can change roles via `/api/users/:id`.

---

### User Management (Admin Only)

These endpoints require `admin` role.

#### GET /api/users
List all users.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "user_id": "uuid",
      "role": "admin",
      "crawl_enabled": true,
      "generation_enabled": true,
      "content_formats": ["linkedin_post", "newsletter"],
      "timezone": "America/New_York",
      "last_crawl_at": "2026-01-04T10:00:00Z",
      "last_generation_at": "2026-01-01T08:00:00Z",
      "created_at": "2026-01-01T00:00:00Z"
    }
  ]
}
```

#### GET /api/users/:user_id
Get user details with content counts.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "user_id": "uuid",
    "role": "user",
    "crawl_enabled": true,
    "generation_enabled": true,
    "content_formats": ["linkedin_post"],
    "timezone": "America/New_York",
    "counts": {
      "source_materials": 12,
      "documents": 156,
      "assets": 45,
      "trend_sources": 8
    }
  }
}
```

#### PATCH /api/users/:user_id
Update a user's role (admin only).

**Request Body:**
```json
{
  "role": "admin"
}
```

**Valid roles:** `admin`, `user`

---

### Allowed Emails (Admin Only)

Manage the email allowlist for invite-only access.

#### GET /api/allowed-emails
List all allowed emails.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "email": "user@example.com",
      "added_by": "admin-user-uuid",
      "created_at": "2026-01-04T10:00:00Z"
    }
  ]
}
```

#### POST /api/allowed-emails
Add an email to the allowlist.

**Request Body:**
```json
{
  "email": "newuser@example.com"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "email": "newuser@example.com",
    "added_by": "admin-user-uuid",
    "created_at": "2026-01-04T10:00:00Z"
  }
}
```

**Error (409 - already exists):**
```json
{
  "success": false,
  "error": "Email already in allowlist"
}
```

#### DELETE /api/allowed-emails/:email
Remove an email from the allowlist.

**Example:**
```
DELETE /api/allowed-emails/user@example.com
```

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Email removed from allowlist"
  }
}
```

**Note:** Removing an email does not immediately revoke access for users who are already signed in. Their existing JWT tokens will continue to work until they expire. To fully revoke access, you would also need to delete the user from Supabase Auth.

---

### Dashboard & Stats

#### GET /api/stats
Returns overview statistics for the dashboard.

**Response:**
```json
{
  "success": true,
  "data": {
    "counts": {
      "source_materials": 6,
      "documents": 216,
      "extractions": 23,
      "assets": {
        "total": 55,
        "by_status": { "draft": 55, "ready": 0, "published": 0 },
        "by_type": { "newsletter": 4, "blog_post": 4, "linkedin_post": 23, "twitter_post": 24 }
      },
      "trend_sources": 28
    },
    "recent": {
      "assets": [...],
      "source_materials": [...],
      "documents": [...]
    },
    "activity": {
      "extractions_this_week": 0,
      "assets_this_week": 55,
      "documents_this_week": 0
    },
    "scheduler": {
      "isRunning": false,
      "schedule": "0 */6 * * *",
      "lastRunAt": "2026-01-04T18:00:00.000Z",
      "lastRunResult": {
        "crawl": { "crawled": 3, "documents": 12, "errors": [] },
        "extraction": { "extracted": 10, "errors": [] }
      }
    }
  }
}
```

---

### Assets (Generated Content)

Assets are the generated content pieces: newsletters, blog posts, LinkedIn posts, Twitter posts.

#### GET /api/assets
List all assets with optional filtering.

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| type | string | Filter by type: `newsletter`, `blog_post`, `linkedin_post`, `twitter_post` |
| status | string | Filter by status: `draft`, `ready`, `published`, `archived` |
| limit | number | Results per page (default: 50) |
| offset | number | Pagination offset (default: 0) |

**Response:**
```json
{
  "success": true,
  "data": {
    "assets": [
      {
        "id": "uuid",
        "type": "linkedin_post",
        "title": "Marketing Tool Selection Guide",
        "status": "draft",
        "publish_date": null,
        "published_url": null,
        "created_at": "2026-01-04T15:07:37.238Z",
        "updated_at": "2026-01-04T15:07:37.238Z"
      }
    ],
    "total": 55,
    "limit": 50,
    "offset": 0
  }
}
```

#### GET /api/assets/:id
Get single asset with full content and provenance (which sources it came from).

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "type": "linkedin_post",
    "title": "Marketing Tool Selection Guide",
    "content": "Full content text here...",
    "status": "draft",
    "publish_date": null,
    "published_url": null,
    "created_at": "2026-01-04T15:07:37.238Z",
    "updated_at": "2026-01-04T15:07:37.238Z",
    "asset_inputs": [
      {
        "id": "uuid",
        "note": "Generated via weekly batch",
        "source_material_id": "uuid",
        "document_id": null,
        "source_materials": { "id": "uuid", "title": "Meeting with Client", "type": "meeting" },
        "documents": null
      }
    ]
  }
}
```

#### PATCH /api/assets/:id
Update an asset's status, title, content, or publishing info.

**Request Body:**
```json
{
  "status": "ready",
  "title": "Updated Title",
  "content": "Updated content...",
  "publish_date": "2026-01-05T10:00:00Z",
  "published_url": "https://linkedin.com/post/123"
}
```
All fields are optional. Only include fields you want to update.

**Valid status values:** `draft`, `ready`, `published`, `archived`

#### DELETE /api/assets/:id
Delete an asset.

**Response:**
```json
{
  "success": true,
  "data": { "message": "Asset deleted successfully" }
}
```

---

### Documents (Crawled Articles)

Documents are articles crawled from trend sources (blogs, news sites).

#### GET /api/documents
List crawled documents.

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| source_id | uuid | Filter by trend source |
| extracted | boolean | Filter by extraction status (`true` or `false`) |
| limit | number | Results per page (default: 50) |
| offset | number | Pagination offset (default: 0) |

**Response:**
```json
{
  "success": true,
  "data": {
    "documents": [
      {
        "id": "uuid",
        "title": "Article Title",
        "url": "https://example.com/article",
        "published_at": "2026-01-03T00:00:00Z",
        "crawled_at": "2026-01-04T10:00:00Z",
        "trend_source_id": "uuid",
        "trend_sources": {
          "id": "uuid",
          "name": "TechCrunch",
          "url": "https://techcrunch.com"
        }
      }
    ],
    "total": 216,
    "limit": 50,
    "offset": 0
  }
}
```

#### GET /api/documents/:id
Get single document with full content and extraction.

---

### Source Materials (Personal Content)

Source materials are personal inputs: meeting transcripts, podcast transcripts, voice notes, manual notes.

#### GET /api/source-materials
List all source materials.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "title": "Meeting with Client",
      "type": "meeting",
      "content": "Transcript content...",
      "occurred_at": "2026-01-03T14:00:00Z",
      "created_at": "2026-01-04T05:43:02Z"
    }
  ]
}
```

**Source material types:** `meeting`, `podcast`, `voice_note`, `manual_note`, `trend`

#### POST /api/ingest/voice-note
Ingest a voice note.

**Request Body:**
```json
{
  "title": "Quick thought on pricing",
  "content": "Transcribed voice note content...",
  "occurred_at": "2026-01-04T10:00:00Z"
}
```

#### POST /api/ingest/manual-note
Ingest a manual note.

**Request Body:**
```json
{
  "title": "Product idea",
  "content": "Note content...",
  "occurred_at": "2026-01-04T10:00:00Z"
}
```

#### POST /api/ingest/trend
Ingest a trend or signal.

**Request Body:**
```json
{
  "title": "Optional title",
  "content": "The transcript or content",
  "source_url": "https://example.com/article",
  "occurred_at": "2026-01-03T10:00:00Z"
}
```

#### POST /api/ingest/fireflies
Ingest a Fireflies meeting transcript.

Accepts either:
- Fireflies API response format: `{ data: { transcript: {...} } }`
- Downloaded JSON format: `{ title: "Meeting", sentences: [...] }`
- Raw sentences array with `?title=` query param

#### POST /api/ingest/podcast
Ingest a podcast episode transcript.

**Request Body:**
```json
{
  "title": "Episode 42: AI in Marketing",
  "content": "The full transcript text...",
  "source_url": "https://podcast.com/episode-42",
  "occurred_at": "2026-01-03T10:00:00Z"
}
```

**Required fields:** `title`, `content`

**Optional fields:** `source_url` (link to episode), `occurred_at` (recording/publish date)

---

### Extractions (AI Summaries)

Extractions are AI-generated summaries of source materials and documents.

#### GET /api/extractions
List all extractions.

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| limit | number | Results to return (default: 50) |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "source_material_id": "uuid",
      "document_id": null,
      "summary": "Summary of the content...",
      "key_points": ["Point 1", "Point 2"],
      "topics": ["Marketing", "Strategy"],
      "extracted_at": "2026-01-04T10:00:00Z"
    }
  ]
}
```

#### POST /api/extractions/batch
Run extraction on unprocessed content.

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| limit | number | Max items to process (default: 10) |

---

### Templates (Content Prompts)

Templates control how content is generated.

#### GET /api/templates
List all available templates.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "key": "linkedin_post",
      "name": "LinkedIn Post",
      "description": "Professional post with hook, insight, and CTA",
      "suggestedInputs": "1-3 extractions"
    },
    {
      "key": "newsletter",
      "name": "Newsletter (4-Section)",
      "description": "Personal Content Machine format: Signal, Lever, Pulse, Next Move",
      "suggestedInputs": "5+ extractions (mix of personal and external sources)"
    }
  ]
}
```

#### GET /api/templates/:key
Get template with full prompt.

#### PUT /api/templates/:key
Create or update a template override (per-user customization).

**Request Body:**
```json
{
  "name": "My Custom LinkedIn Post",
  "description": "Custom description",
  "prompt": "Custom prompt text..."
}
```

#### DELETE /api/templates/:key
Remove override, revert to default prompt.

---

### Content Generation

#### POST /api/generate/adhoc
Generate content from specific extractions.

**Request Body:**
```json
{
  "extraction_ids": ["uuid1", "uuid2"],
  "formats": ["linkedin_post", "twitter_post"],
  "instructions": "Optional additional instructions for generation"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "generated": 2,
    "extractions_used": 2,
    "assets": [
      {
        "id": "uuid",
        "type": "linkedin_post",
        "title": "Generated Title",
        "content": "Generated content...",
        "status": "draft"
      }
    ]
  }
}
```

#### POST /api/generate/weekly
Trigger full weekly content generation (runs in background).

#### GET /api/generate/status
Check generation status.

---

### Trend Sources

Trend sources are blogs/sites that get crawled for articles.

#### GET /api/trend-sources
List all trend sources.

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| tier | number | Filter by tier (1, 2, or 3) |
| status | string | Filter by status: `active`, `paused`, `blocked` |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "TechCrunch",
      "domain": "techcrunch.com",
      "feed_url": "https://techcrunch.com/feed",
      "sitemap_url": null,
      "crawl_method": "rss",
      "tier": 1,
      "status": "active",
      "trust_score": 85,
      "notes": "Great for startup news",
      "created_at": "2026-01-01T00:00:00Z"
    }
  ]
}
```

#### POST /api/trend-sources
Create a new trend source.

**Request Body:**
```json
{
  "name": "TechCrunch",
  "domain": "techcrunch.com",
  "feed_url": "https://techcrunch.com/feed",
  "crawl_method": "rss",
  "tier": 1,
  "status": "active"
}
```

**Required:** `name`

**crawl_method values:** `rss`, `sitemap`, `html`, `api`, `manual`

**status values:** `active`, `paused`, `blocked`

**tier values:** `1` (high priority), `2` (medium), `3` (low)

#### PATCH /api/trend-sources/:id
Update a trend source.

#### DELETE /api/trend-sources/:id
Delete a trend source.

---

### Crawling

#### POST /api/crawl/sources
Crawl all active trend sources (or filter by tier).

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| tier | number | Only crawl sources of this tier |
| limit | number | Max articles per source (default: 10) |

#### POST /api/crawl/url
Crawl a single URL.

**Request Body:**
```json
{
  "url": "https://example.com/article-to-scrape"
}
```

---

### Scheduler

#### POST /api/scheduler/trigger
Manually trigger crawl and extraction jobs.

---

## Data Types

### User Roles
- `admin` - Can manage all users, change roles, view all user data
- `user` - Standard access, can manage their own content

### Asset Types
- `newsletter` - Weekly newsletter (4-section format)
- `blog_post` - Long-form blog article
- `linkedin_post` - LinkedIn post
- `twitter_post` - Twitter/X post or thread

### Asset Statuses
- `draft` - Initial generated state
- `ready` - Reviewed and approved for publishing
- `published` - Published to platform
- `archived` - No longer active

### Source Material Types
- `meeting` - Meeting transcript (from Fireflies)
- `podcast` - Podcast episode transcript
- `voice_note` - Voice note transcript
- `manual_note` - Manually entered note
- `trend` - Trend or signal note

### Crawl Schedules
- `manual` - Only crawl on demand
- `every_6_hours` - Crawl 4 times daily
- `twice_daily` - Crawl morning and evening
- `daily` - Crawl once per day

### Generation Schedules
- `manual` - Only generate on demand
- `daily` - Generate every day
- `weekly_sunday` - Generate every Sunday
- `weekly_monday` - Generate every Monday

---

## Error Responses

All endpoints return errors in this format:
```json
{
  "success": false,
  "error": "Error message describing what went wrong"
}
```

Common HTTP status codes:
- `400` - Bad request (invalid parameters)
- `401` - Unauthorized (missing or invalid token)
- `403` - Forbidden (insufficient permissions, e.g., non-admin accessing admin endpoints)
- `404` - Resource not found
- `405` - Method not allowed
- `500` - Internal server error
