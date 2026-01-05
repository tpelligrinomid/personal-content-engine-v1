# Frontend Architecture for Personal Content Engine

## Authentication

All API requests (except `/health` and `/`) require an API key header:

```
Authorization: Bearer <API_KEY>
```

The frontend should store the API key securely and include it in all fetch requests.

---

## Recommended Pages

```
/                       → Dashboard
/content                → Assets list (generated content)
/content/:id            → Asset detail/editor
/sources                → Source management (tabs: Trend Sources, Personal)
/sources/trends/:id     → Edit trend source
/documents              → Crawled articles browser
/documents/:id          → Document detail with extraction
/generate               → Ad-hoc generation wizard
/templates              → Template management
/settings               → Scheduler controls (trigger, status)
```

---

## Page Breakdown

### 1. Dashboard (`/`)
**Purpose:** Quick health check and action center

**Components:**
- Stats cards (from `GET /api/stats`)
  - Total assets, by status (draft/ready/published)
  - Documents crawled this week
  - Extractions this week
- Recent assets list (5 items, link to `/content`)
- Recent source materials (5 items)
- Quick actions:
  - "Generate Content" button → `/generate`
  - "Trigger Crawl" button → `POST /api/scheduler/trigger`

---

### 2. Content Library (`/content`)
**Purpose:** Manage generated content through publishing workflow

**API:** `GET /api/assets?type=&status=`

**Layout:**
- Filter bar: Type dropdown, Status dropdown
- Card grid or table view
- Each card shows: type icon, title, status badge, created date
- Click → `/content/:id`

**Status workflow:** `draft` → `ready` → `published`

---

### 3. Asset Detail (`/content/:id`)
**Purpose:** View, edit, and publish individual content pieces

**API:** `GET /api/assets/:id`, `PATCH /api/assets/:id`

**Layout:**
- Header: Title (editable), type badge, status badge
- Content area: Markdown editor or rich text (depending on type)
- Sidebar:
  - Status selector (draft/ready/published/archived)
  - Publish date picker
  - Published URL input
  - Provenance section: "Created from" with links to source materials/documents
- Actions: Save, Delete, Copy to clipboard

---

### 4. Sources (`/sources`)
**Purpose:** Manage content inputs

**Tabs:**
1. **Trend Sources** - blogs/sites being crawled
2. **Personal** - meetings, voice notes, manual notes

**Trend Sources Tab:**
- API: `GET /api/trend-sources`
- Table: name, domain, tier, status, last_crawled_at
- Actions: Add new, Edit, Delete, Toggle status
- Add modal: name, domain, feed_url, crawl_method, tier

**Personal Tab:**
- API: `GET /api/source-materials`
- Table: title, type, occurred_at, created_at
- Type icons: meeting, voice_note, manual_note
- Add manual note button → modal with title, content, occurred_at

---

### 5. Documents (`/documents`)
**Purpose:** Browse crawled articles

**API:** `GET /api/documents?source_id=&extracted=`

**Layout:**
- Filter: Source dropdown, Extracted toggle
- Card list: title, source name, published_at, extraction status badge
- Click → `/documents/:id`

---

### 6. Document Detail (`/documents/:id`)
**Purpose:** Read article with AI extraction

**API:** `GET /api/documents/:id`

**Layout:**
- Header: title, source link, published date
- Two columns:
  - Left: Full article content
  - Right: Extraction card (summary, key points, topics)
- Action: "Generate from this" → opens `/generate` with this extraction pre-selected

---

### 7. Generate (`/generate`)
**Purpose:** Ad-hoc content generation wizard

**API:** `GET /api/extractions`, `GET /api/templates`, `POST /api/generate/adhoc`

**Flow:**
1. **Select Extractions** - checkbox list of available extractions
   - Show source type icon, title, summary preview
   - Filter by source type (personal vs external)
2. **Select Formats** - checkbox list of templates
   - Show name, description, suggested inputs
3. **Add Instructions** (optional) - text area
4. **Generate** → shows progress, then redirects to `/content` filtered to new assets

---

### 8. Templates (`/templates`)
**Purpose:** Customize generation prompts

**API:** `GET /api/templates`, `GET /api/templates/:key`, `PUT /api/templates/:key`

**Layout:**
- Card for each template: name, description, "Has override" badge
- Click to expand/edit
- Edit view: prompt textarea, name, description
- Reset to default button (calls `DELETE`)

---

## Component Library Suggestions

| Component | Usage |
|-----------|-------|
| StatusBadge | `draft` (gray), `ready` (blue), `published` (green), `archived` (dim) |
| TypeIcon | newsletter, blog_post, linkedin_post, twitter_post |
| SourceIcon | meeting, voice_note, manual_note, article |
| StatsCard | Number + label + optional trend indicator |
| ContentCard | Title, type, status, date, preview |
| ExtractionCard | Summary, key points list, topic tags |

---

## Data Flow

```
Trend Sources → Crawl → Documents → Extract → Extractions
                                                    ↓
Source Materials → Extract → Extractions → Generate → Assets
                                                    ↓
                                              Content Library
                                                    ↓
                                              Publish Workflow
```

---

## API Quick Reference

### Dashboard
```
GET /api/stats
```
Returns: counts, recent items, weekly activity, and scheduler status (isRunning, schedule, lastRunAt, lastRunResult)

### Assets (Generated Content)
```
GET    /api/assets              → List (?type=&status=&limit=&offset=)
GET    /api/assets/:id          → Single with provenance
PATCH  /api/assets/:id          → Update (status, title, content, publish_date, published_url)
DELETE /api/assets/:id          → Delete
```

### Documents (Crawled Articles)
```
GET /api/documents              → List (?source_id=&extracted=true/false)
GET /api/documents/:id          → Single with extraction
```

### Source Materials (Personal Content)
```
GET  /api/source-materials      → List all
POST /api/ingest/voice-note     → Add voice note
POST /api/ingest/manual-note    → Add manual note
```

### Trend Sources
```
GET    /api/trend-sources       → List (?tier=&status=)
POST   /api/trend-sources       → Create (name required)
PATCH  /api/trend-sources/:id   → Update
DELETE /api/trend-sources/:id   → Delete
```

### Extractions
```
GET  /api/extractions           → List (?limit=)
POST /api/extractions/batch     → Run extraction (?limit=)
```

### Templates
```
GET    /api/templates           → List all
GET    /api/templates/:key      → Get with prompt
PUT    /api/templates/:key      → Create/update override
DELETE /api/templates/:key      → Revert to default
```

### Generation
```
POST /api/generate/adhoc        → Generate from extractions
POST /api/generate/weekly       → Full batch (background)
GET  /api/generate/status       → Check generation status
```

### Scheduler
```
POST /api/scheduler/trigger     → Manual crawl + extract
```

---

## Type Reference

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

### Trend Source Fields
- `crawl_method`: `rss`, `sitemap`, `html`
- `status`: `active`, `paused`, `dead`
- `tier`: `1` (high priority), `2` (medium), `3` (low)

### Template Keys
- `linkedin_post` - Professional post with hook, insight, CTA
- `linkedin_pov` - Opinion-driven post with personal perspective
- `twitter_post` - Concise tweet or short thread
- `twitter_thread` - Multi-tweet thread
- `blog_post` - Long-form SEO-friendly article
- `newsletter` - 4-section Personal Content Machine format
