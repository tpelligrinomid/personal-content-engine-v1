# Lovable Prompt: Add Content Button & Manual Asset Creation

## Overview
Update the Content page to have two action buttons instead of one:
1. **Generate** (with sparkles/AI icon) - Opens the existing generation flow
2. **Add** (with plus icon) - Opens a new form to manually add existing content

## UI Changes

### Header Button Layout
Replace the current "Generate New" button with two buttons:

```
[Manage Tags]  [Generate ✨]  [+ Add]
```

- **Generate** button: Green/primary color with sparkles icon (✨ or Sparkles from lucide-react), opens existing generation modal/page
- **Add** button: Secondary/outline style with Plus icon, opens new "Add Content" modal

### Add Content Modal/Dialog

Create a modal dialog with the following form fields:

```
┌─────────────────────────────────────────────────────┐
│  Add Existing Content                           [X] │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Content Type *                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │ Select type...                            ▼ │   │
│  └─────────────────────────────────────────────┘   │
│  Options: LinkedIn Post, Twitter Post, Blog Post,  │
│           Newsletter, Video Script, Podcast Segment │
│                                                     │
│  Title *                                            │
│  ┌─────────────────────────────────────────────┐   │
│  │                                             │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  Content * (Markdown supported)                     │
│  ┌─────────────────────────────────────────────┐   │
│  │                                             │   │
│  │                                             │   │
│  │                                             │   │
│  │                                             │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  Status                                             │
│  ┌─────────────────────────────────────────────┐   │
│  │ Draft                                     ▼ │   │
│  └─────────────────────────────────────────────┘   │
│  Options: Draft, Ready, Published, Archived        │
│                                                     │
│  ── Only show if status is "Published" ──          │
│                                                     │
│  Published URL (optional)                           │
│  ┌─────────────────────────────────────────────┐   │
│  │ https://                                    │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  Publish Date (optional)                            │
│  ┌─────────────────────────────────────────────┐   │
│  │ 📅 Select date                              │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│                          [Cancel]  [Add Content]    │
└─────────────────────────────────────────────────────┘
```

## API Integration

### Create Asset Endpoint
```
POST /api/assets
Authorization: Bearer <token>
Content-Type: application/json

{
  "type": "blog_post",           // Required: linkedin_post, twitter_post, blog_post, newsletter, video_script, podcast_segment
  "title": "My Blog Post Title", // Required
  "content": "Full markdown content here...", // Required
  "status": "published",         // Optional, defaults to "draft"
  "published_url": "https://myblog.com/post-slug",  // Optional
  "publish_date": "2025-01-10T00:00:00Z"  // Optional, ISO format
}
```

### Success Response
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "type": "blog_post",
    "title": "My Blog Post Title",
    "content": "...",
    "status": "published",
    "published_url": "https://...",
    "publish_date": "2025-01-10T00:00:00Z",
    "created_at": "...",
    "updated_at": "..."
  }
}
```

### Error Response
```json
{
  "success": false,
  "error": "Required fields: type, title, content"
}
```

## Form Validation

1. **Type** - Required, must select from dropdown
2. **Title** - Required, minimum 1 character
3. **Content** - Required, minimum 1 character
4. **Status** - Optional, defaults to "draft"
5. **Published URL** - Optional, only shown when status is "Published", validate URL format
6. **Publish Date** - Optional, only shown when status is "Published"

## User Flow

1. User clicks "+ Add" button
2. Modal opens with empty form
3. User selects content type from dropdown
4. User enters title
5. User enters/pastes content (markdown textarea with reasonable height ~200px)
6. User optionally changes status
7. If status is "Published":
   - Show published_url field
   - Show publish_date field (default to today)
8. User clicks "Add Content"
9. On success:
   - Close modal
   - Show success toast: "Content added successfully"
   - Refresh content list
   - New content appears at top of list
10. On error:
    - Show error toast with message
    - Keep modal open for correction

## Component Structure

```
ContentPage
├── Header
│   ├── Title "Content"
│   ├── Subtitle "Manage your generated assets (X total)"
│   └── Actions
│       ├── ManageTagsButton
│       ├── GenerateButton (sparkles icon)
│       └── AddButton (plus icon) → opens AddContentModal
├── FilterBar
│   └── ... existing filters ...
├── ContentGrid
│   └── ... existing grid ...
└── AddContentModal (new component)
    ├── TypeSelect
    ├── TitleInput
    ├── ContentTextarea
    ├── StatusSelect
    ├── PublishedUrlInput (conditional)
    ├── PublishDatePicker (conditional)
    └── ActionButtons
```

## Styling Notes

- Use existing design system components (Select, Input, Textarea, Button, Dialog/Modal)
- Content textarea should support markdown and have a monospace or code-friendly font option
- Consider adding a small "Markdown supported" helper text below the textarea
- The Add button should be visually distinct from Generate (outline/secondary vs filled/primary)
- Match existing modal styling patterns in the app

## Nice to Have (Optional Enhancements)

1. **Markdown Preview Toggle** - Button to preview rendered markdown
2. **Character/Word Count** - Show count below content textarea
3. **Quick Tags** - Allow adding tags immediately after creation
4. **Duplicate Detection** - Warn if title matches existing asset
