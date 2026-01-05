# Frontend Architecture for Personal Content Engine

## Authentication (Google OAuth)

This is an **invite-only** application using Supabase Auth with Google OAuth.

### Auth Flow

```
1. User clicks "Sign in with Google"
2. Supabase handles OAuth redirect
3. User authenticates with Google
4. Backend checks if email is in allowed_emails table
5. If allowed → access granted
6. If not allowed → 401 "Email not authorized"
```

### Implementation

```javascript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Sign in
async function signIn() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin
    }
  });
}

// Sign out
async function signOut() {
  await supabase.auth.signOut();
}

// Get session for API calls
async function getAuthHeader() {
  const { data: { session } } = await supabase.auth.getSession();
  return session ? { Authorization: `Bearer ${session.access_token}` } : {};
}

// API call example
async function fetchStats() {
  const headers = await getAuthHeader();
  const res = await fetch('/api/stats', { headers });
  return res.json();
}
```

### Auth States

| State | UI |
|-------|-----|
| No session | Show login page with "Sign in with Google" button |
| Session but 401 from API | Show "Access pending" message (email not in allowlist) |
| Valid session + API works | Show main app |

---

## User Roles

| Role | Capabilities |
|------|-------------|
| `user` | Manage own content, sources, settings |
| `admin` | All user capabilities + manage users + manage allowed emails |

Check role via `GET /api/settings` → `data.role`

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
/settings               → User settings (schedules, formats, timezone)
/admin/users            → User management (admin only)
/admin/allowed-emails   → Email allowlist management (admin only)
```

---

## Page Breakdown

### 1. Login Page
**Purpose:** Authenticate users

**Components:**
- App logo/branding
- "Sign in with Google" button
- After auth, if 401: "Your email hasn't been approved yet. Contact an administrator."

---

### 2. Dashboard (`/`)
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
- Scheduler status display (last run, result summary)

---

### 3. Content Library (`/content`)
**Purpose:** Manage generated content through publishing workflow

**API:** `GET /api/assets?type=&status=`

**Layout:**
- Filter bar: Type dropdown, Status dropdown
- Card grid or table view
- Each card shows: type icon, title, status badge, created date
- Click → `/content/:id`

**Status workflow:** `draft` → `ready` → `published`

---

### 4. Asset Detail (`/content/:id`)
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

### 5. Sources (`/sources`)
**Purpose:** Manage content inputs

**Tabs:**
1. **Trend Sources** - blogs/sites being crawled
2. **Personal** - meetings, voice notes, podcasts, manual notes

**Trend Sources Tab:**
- API: `GET /api/trend-sources`
- Table: name, domain, tier, status, last_crawled_at
- Actions: Add new, Edit, Delete, Toggle status
- Add modal: name, domain, feed_url, crawl_method, tier

**Personal Tab:**
- API: `GET /api/source-materials`
- Table: title, type, occurred_at, created_at
- Type icons: meeting, podcast, voice_note, manual_note
- Add buttons:
  - "Add Manual Note" → modal with title, content, occurred_at
  - "Add Podcast Transcript" → modal with title, content, source_url, occurred_at

---

### 6. Documents (`/documents`)
**Purpose:** Browse crawled articles

**API:** `GET /api/documents?source_id=&extracted=`

**Layout:**
- Filter: Source dropdown, Extracted toggle
- Card list: title, source name, published_at, extraction status badge
- Click → `/documents/:id`

---

### 7. Document Detail (`/documents/:id`)
**Purpose:** Read article with AI extraction

**API:** `GET /api/documents/:id`

**Layout:**
- Header: title, source link, published date
- Two columns:
  - Left: Full article content
  - Right: Extraction card (summary, key points, topics)
- Action: "Generate from this" → opens `/generate` with this extraction pre-selected

---

### 8. Generate (`/generate`)
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

### 9. Templates (`/templates`)
**Purpose:** Customize generation prompts (per-user overrides)

**API:** `GET /api/templates`, `GET /api/templates/:key`, `PUT /api/templates/:key`, `DELETE /api/templates/:key`

**Layout:**
- Card for each template: name, description, "Customized" badge if has override
- Click to expand/edit
- Edit view: prompt textarea, name, description
- "Reset to Default" button (calls `DELETE`)

**Note:** Each user can customize templates. Changes only affect their account.

---

### 10. Settings (`/settings`)
**Purpose:** Configure personal preferences and content profile

**API:** `GET /api/settings`, `PATCH /api/settings`

**Sections:**

**Content Profile** (NEW - shapes all generated content):
- Content Pillars (array of strings): 3-6 core topics to focus on
  - Example: ["Agency M&A", "Team Building", "Agency Operations", "Entrepreneurship"]
- Professional Background (text): Credentials and experience to reference
  - Example: "Founder of Punctuation, 15 years in agency world, completed multiple acquisitions"
- Target Audience (text): Who you're writing for
  - Example: "Agency owners, marketing leaders, entrepreneurs considering exits"
- Voice & Tone (text): How content should sound
  - Example: "Direct, practical, occasionally provocative. No fluff."
- Unique Angle (text): What makes your perspective different
  - Example: "Practitioner POV - I've been in the trenches, not just advising"
- Signature Elements (text): Recurring themes, phrases, frameworks
  - Example: "The 3-legged stool of agency value; always include actionable takeaway"

**Content Generation:**
- Content formats checkboxes:
  - LinkedIn Post, LinkedIn POV, Twitter Post, Twitter Thread
  - Blog Post, Newsletter, Video Script, Podcast Segment
- Generation schedule: Manual, Daily, Weekly Sunday, Weekly Monday
- Generation time picker (for scheduled generation)

**Crawling:**
- Crawl enabled toggle
- Crawl schedule: Manual, Every 6 Hours, Twice Daily, Daily

**General:**
- Timezone selector

**Display only (not editable):**
- User role badge (admin/user)
- Last crawl timestamp
- Last generation timestamp

---

### 11. Admin: User Management (`/admin/users`)
**Purpose:** View and manage users (admin only)

**API:** `GET /api/users`, `GET /api/users/:id`, `PATCH /api/users/:id`

**Gate:** Check `settings.role === 'admin'` before showing

**Layout:**
- Table: email (from user_id lookup), role, content counts, created_at
- Click row → detail view with:
  - User info
  - Content counts (source materials, documents, assets, trend sources)
  - Role selector (user/admin)
  - Save button

---

### 12. Admin: Allowed Emails (`/admin/allowed-emails`)
**Purpose:** Manage invite list (admin only)

**API:** `GET /api/allowed-emails`, `POST /api/allowed-emails`, `DELETE /api/allowed-emails/:email`

**Gate:** Check `settings.role === 'admin'` before showing

**Layout:**
- Add email form: email input + "Add" button
- Table: email, added_by, created_at, delete button
- Confirmation dialog for delete

---

## Component Library Suggestions

| Component | Usage |
|-----------|-------|
| StatusBadge | `draft` (gray), `ready` (blue), `published` (green), `archived` (dim) |
| TypeIcon | newsletter, blog_post, linkedin_post, twitter_post, video_script, podcast_segment |
| SourceIcon | meeting, podcast, voice_note, manual_note, article |
| RoleBadge | admin (purple), user (gray) |
| StatsCard | Number + label + optional trend indicator |
| ContentCard | Title, type, status, date, preview |
| ExtractionCard | Summary, key points list, topic tags |

---

## Navigation

**Standard user navigation:**
```
Dashboard | Content | Sources | Documents | Generate | Templates | Settings
```

**Admin navigation (additional):**
```
Dashboard | Content | Sources | Documents | Generate | Templates | Settings | Admin ▼
                                                                              └─ Users
                                                                              └─ Allowed Emails
```

---

## Data Flow

```
Trend Sources → Crawl → Documents → Extract → Extractions
                                                    ↓
Source Materials → Extract → Extractions → Generate → Assets
(meetings, podcasts,                                    ↓
 voice notes, manual)                            Content Library
                                                       ↓
                                                 Publish Workflow
```

---

## Archive Feature

Content can be archived to declutter lists without deleting data.

**Supported on:**
- Source Materials (meetings, podcasts, voice notes, manual notes)
- Documents (crawled articles)
- Extractions

**Query Parameters (all list endpoints):**
| Parameter | Effect |
|-----------|--------|
| (default) | Returns only non-archived items |
| `include_archived=true` | Returns all items (archived + non-archived) |
| `archived_only=true` | Returns only archived items |

**Archive Actions:**
```
POST /api/source-materials/:id/archive   → Archive
POST /api/source-materials/:id/unarchive → Unarchive
POST /api/documents/:id/archive          → Archive
POST /api/documents/:id/unarchive        → Unarchive
POST /api/extractions/:id/archive        → Archive
POST /api/extractions/:id/unarchive      → Unarchive
```

**Cascading:**
- Archiving a source material → automatically archives its extraction
- Archiving a document → automatically archives its extraction
- Unarchiving → automatically unarchives the related extraction

**UI Suggestions:**
- Add archive/unarchive buttons on list items and detail views
- Add "Show archived" toggle filter
- Display `archived_at` timestamp on archived items
- Consider bulk archive for cleaning up multiple items

---

## API Quick Reference

### Authentication
```
POST supabase.auth.signInWithOAuth({ provider: 'google' })
POST supabase.auth.signOut()
GET  supabase.auth.getSession() → access_token for Authorization header
```

### User Settings
```
GET   /api/settings           → Current user's settings (includes role)
PATCH /api/settings           → Update settings (schedules, formats, timezone)
```

### Admin: Users (admin only)
```
GET   /api/users              → List all users
GET   /api/users/:id          → User detail with content counts
PATCH /api/users/:id          → Update role
```

### Admin: Allowed Emails (admin only)
```
GET    /api/allowed-emails           → List all allowed emails
POST   /api/allowed-emails           → Add email { email: "..." }
DELETE /api/allowed-emails/:email    → Remove email
```

### Dashboard
```
GET /api/stats
```
Returns: counts, recent items, weekly activity, and scheduler status

### Assets (Generated Content)
```
GET    /api/assets              → List (?type=&status=&limit=&offset=)
GET    /api/assets/:id          → Single with provenance
PATCH  /api/assets/:id          → Update (status, title, content, publish_date, published_url)
DELETE /api/assets/:id          → Delete
```

### Documents (Crawled Articles)
```
GET  /api/documents              → List (?source_id=&extracted=&include_archived=&archived_only=)
GET  /api/documents/:id          → Single with extraction
POST /api/documents/:id/archive  → Archive document (cascades to extraction)
POST /api/documents/:id/unarchive → Unarchive document (cascades to extraction)
```

### Source Materials (Personal Content)
```
GET  /api/source-materials            → List (?type=&include_archived=&archived_only=)
POST /api/source-materials/:id/archive   → Archive (cascades to extraction)
POST /api/source-materials/:id/unarchive → Unarchive (cascades to extraction)
POST /api/ingest/voice-note           → Add voice note
POST /api/ingest/manual-note          → Add manual note
POST /api/ingest/podcast              → Add podcast transcript
POST /api/ingest/fireflies            → Add meeting transcript
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
GET  /api/extractions              → List (?source_type=&include_archived=&archived_only=&limit=)
POST /api/extractions/batch        → Run extraction (?limit=)
POST /api/extractions/:id/archive  → Archive extraction
POST /api/extractions/:id/unarchive → Unarchive extraction
```

### Templates
```
GET    /api/templates           → List all
GET    /api/templates/:key      → Get with prompt
PUT    /api/templates/:key      → Create/update user override
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
- `video_script` - Short-form video script (30-90 sec for TikTok/Reels/Shorts)
- `podcast_segment` - Solo podcast segment script (5-10 minutes)

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

### User Roles
- `admin` - Can manage users and allowed emails
- `user` - Standard access

### Content Profile Fields (in user_settings)
These fields shape all generated content for the user:
- `content_pillars` (string[]) - Core topics to focus on (3-6 recommended)
- `professional_background` (string | null) - Credentials and experience
- `target_audience` (string | null) - Who the user writes for
- `voice_tone` (string | null) - How content should sound
- `unique_angle` (string | null) - What makes their perspective different
- `signature_elements` (string | null) - Recurring themes, phrases, frameworks

### Trend Source Fields
- `crawl_method`: `rss`, `sitemap`, `html`, `api`, `manual`
- `status`: `active`, `paused`, `blocked`
- `tier`: `1` (high priority), `2` (medium), `3` (low)

### Template Keys
- `linkedin_post` - Professional post with hook, insight, CTA
- `linkedin_pov` - Opinion-driven post with personal perspective
- `twitter_post` - Concise tweet or short thread
- `twitter_thread` - Multi-tweet thread
- `blog_post` - Long-form SEO-friendly article
- `newsletter` - 4-section Personal Content Machine format
- `video_script` - Short-form video script with visual cues
- `podcast_segment` - Solo podcast talking points with timing markers

### Schedules
**Crawl:**
- `manual` - Only on demand
- `every_6_hours` - 4 times daily
- `twice_daily` - Morning and evening
- `daily` - Once per day

**Generation:**
- `manual` - Only on demand
- `daily` - Every day
- `weekly_sunday` - Every Sunday
- `weekly_monday` - Every Monday

---

## Environment Variables (Frontend)

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_API_BASE_URL=https://personal-content-engine-v1.onrender.com
```
