# Personal Content Engine API Documentation

## Base URL
```
https://personal-content-engine-v1.onrender.com
```

## Overview

The Personal Content Engine is a backend system that:
1. Ingests content from meetings (Fireflies), voice notes, and web articles
2. Extracts key insights using AI
3. Generates content (newsletters, blog posts, LinkedIn posts, Twitter posts)

---

## Endpoints

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

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "type": "linkedin_post",
    "title": "Updated Title",
    "content": "Updated content...",
    "status": "ready",
    "publish_date": "2026-01-05T10:00:00Z",
    "published_url": "https://linkedin.com/post/123",
    "created_at": "2026-01-04T15:07:37.238Z",
    "updated_at": "2026-01-04T16:00:00.000Z"
  }
}
```

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

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "title": "Article Title",
    "url": "https://example.com/article",
    "content": "Full article content...",
    "published_at": "2026-01-03T00:00:00Z",
    "crawled_at": "2026-01-04T10:00:00Z",
    "trend_source_id": "uuid",
    "trend_sources": {
      "id": "uuid",
      "name": "TechCrunch",
      "url": "https://techcrunch.com",
      "tier": 1
    },
    "extractions": [
      {
        "id": "uuid",
        "summary": "Article summary...",
        "key_points": ["Point 1", "Point 2", "Point 3"],
        "topics": ["AI", "Marketing"],
        "extracted_at": "2026-01-04T11:00:00Z"
      }
    ]
  }
}
```

---

### Source Materials (Personal Content)

Source materials are personal inputs: meeting transcripts, voice notes, manual notes.

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

**Source material types:** `meeting`, `voice_note`, `manual_note`, `trend`

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

**Response:**
```json
{
  "success": true,
  "data": {
    "processed": 5,
    "extractions": [...]
  }
}
```

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
      "key": "linkedin_pov",
      "name": "LinkedIn POV Post",
      "description": "Opinion-driven post with personal perspective",
      "suggestedInputs": "1 extraction (preferably from meeting or voice note)"
    },
    {
      "key": "twitter_post",
      "name": "Twitter/X Post",
      "description": "Concise tweet or short thread",
      "suggestedInputs": "1-2 extractions"
    },
    {
      "key": "twitter_thread",
      "name": "Twitter/X Thread",
      "description": "Multi-tweet thread breaking down a topic",
      "suggestedInputs": "1-3 extractions"
    },
    {
      "key": "blog_post",
      "name": "Blog Post",
      "description": "Long-form article with SEO-friendly structure",
      "suggestedInputs": "2-5 extractions"
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

**Response:**
```json
{
  "success": true,
  "data": {
    "key": "linkedin_post",
    "name": "LinkedIn Post",
    "description": "Professional post with hook, insight, and CTA",
    "suggestedInputs": "1-3 extractions",
    "prompt": "You are creating a LinkedIn post...",
    "hasOverride": false
  }
}
```

#### PUT /api/templates/:key
Create or update a template override.

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

**Response:**
```json
{
  "success": true,
  "message": "Weekly generation started in background",
  "status_endpoint": "/api/generate/status"
}
```

#### GET /api/generate/status
Check generation status.

**Response:**
```json
{
  "success": true,
  "data": {
    "isGenerating": false,
    "lastResult": {
      "completedAt": "2026-01-04T15:10:00Z",
      "assetsCreated": 12
    }
  }
}
```

---

### Trend Sources

Trend sources are blogs/sites that get crawled for articles.

#### GET /api/trend-sources
List all trend sources.

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| tier | number | Filter by tier (1, 2, or 3) |
| status | string | Filter by status: `active`, `paused`, `dead` |

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
      "last_crawled_at": "2026-01-04T10:00:00Z",
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
  "sitemap_url": null,
  "crawl_method": "rss",
  "tier": 1,
  "status": "active",
  "trust_score": 85,
  "notes": "Great for startup news"
}
```

**Required:** `name`

**crawl_method values:** `rss`, `sitemap`, `html`

**status values:** `active`, `paused`, `dead`

**tier values:** `1` (high priority), `2` (medium), `3` (low)

#### PATCH /api/trend-sources/:id
Update a trend source.

**Request Body:** (all fields optional)
```json
{
  "name": "Updated Name",
  "status": "paused",
  "tier": 2
}
```

#### DELETE /api/trend-sources/:id
Delete a trend source.

**Response:**
```json
{
  "success": true,
  "data": { "deleted": "uuid" }
}
```

---

### Scheduler

#### POST /api/scheduler/trigger
Manually trigger crawl and extraction jobs.

**Response:**
```json
{
  "success": true,
  "message": "Job started in background",
  "note": "Check server logs for progress"
}
```

---

## Data Types

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
- `voice_note` - Voice note transcript
- `manual_note` - Manually entered note
- `trend` - Trend or signal note

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
- `404` - Resource not found
- `405` - Method not allowed
- `500` - Internal server error
