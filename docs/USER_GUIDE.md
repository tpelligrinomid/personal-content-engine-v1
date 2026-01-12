# Thoughtful™ by Aragon Holdings - User Guide

A comprehensive guide for creating, managing, and publishing content using Thoughtful™.

---

## Table of Contents

1. [Overview](#overview)
2. [Getting Started](#getting-started)
3. [Content Sources (Feeds)](#content-sources-feeds)
4. [Personal Inputs](#personal-inputs)
5. [Generating Content](#generating-content)
6. [Enriching Content](#enriching-content)
7. [Tags and Organization](#tags-and-organization)
8. [Settings and Content Profile](#settings-and-content-profile)
9. [Common Workflows](#common-workflows)
10. [Tips and Best Practices](#tips-and-best-practices)

---

## Overview

Thoughtful™ helps you create consistent, high-quality content by:

1. **Collecting** content from various sources (RSS feeds, Twitter, Reddit, articles)
2. **Capturing** your personal inputs (meeting notes, voice notes, manual notes)
3. **Extracting** key insights from all sources automatically
4. **Generating** new content in multiple formats (LinkedIn posts, blog posts, newsletters, etc.)
5. **Enriching** content with links, quotes, and SEO metadata
6. **Organizing** everything with tags for easy retrieval

### How It Works

```
Sources & Inputs → Extraction → Generation → Enrichment → Publish
     ↓                ↓              ↓             ↓
  Feeds           Summaries     LinkedIn      Links, SEO
  Twitter         Key Points    Blog Posts    Pull Quotes
  Notes           Topics        Newsletters   Images
```

---

## Getting Started

### First-Time Setup

1. **Complete your Content Profile** (Settings → Content Profile)
   - Add your professional background
   - Define your content pillars (3-5 topics you write about)
   - Describe your target audience
   - Set your voice and tone preferences

2. **Add Content Sources** (Feeds tab)
   - Add RSS feeds from blogs you follow
   - Add Twitter accounts to monitor
   - Add Reddit communities

3. **Set Your Schedule** (Settings)
   - Configure how often to crawl sources
   - Set up auto-generation if desired

---

## Content Sources (Feeds)

Content sources automatically bring in articles, tweets, and posts that can inspire your content.

### Adding a Feed

1. Go to **Inputs → Feeds**
2. Click **Add Feed**
3. Enter the source details:
   - **Name**: A friendly name (e.g., "Seth Godin's Blog")
   - **URL**: The feed URL or website
   - **Type**: RSS, Twitter, Reddit, or Manual

### Supported Source Types

| Type | URL Format | Example |
|------|------------|---------|
| RSS | Feed URL | `https://seths.blog/feed/` |
| Twitter Account | `https://x.com/username` | `https://x.com/naval` |
| Twitter Search | `twitter:search:query` | `twitter:search:AI leadership` |
| Twitter Hashtag | `https://x.com/hashtag/topic` | `https://x.com/hashtag/contentmarketing` |
| Reddit | `https://reddit.com/r/subreddit` | `https://reddit.com/r/entrepreneurs` |

### Source Tiers

- **Tier 1**: High-priority sources, crawled first
- **Tier 2+**: Lower priority, crawled less frequently

### Managing Sources

- **Pause**: Temporarily stop crawling a source
- **Block**: Permanently disable a source
- **Delete**: Remove the source entirely

### Crawled Articles

Articles from your feeds appear in **Inputs → Crawled Articles**. They are:
- Automatically extracted for key insights
- Available as sources for content generation
- Auto-deleted after 30 days to keep things fresh

---

## Personal Inputs

Personal inputs capture your unique insights, ideas, and experiences.

### Types of Personal Inputs

| Type | Best For |
|------|----------|
| **Manual Notes** | Quick ideas, observations, content drafts |
| **Meeting Notes** | Insights from client calls, team meetings |
| **Voice Notes** | Spoken ideas, podcast-style thoughts |
| **Podcasts** | Podcast transcripts and summaries |

### Adding Personal Inputs

1. Go to **Inputs → Personal**
2. Click the appropriate input type
3. Add your content:
   - **Title** (optional): A descriptive title
   - **Content**: The main text/transcript
   - **Date**: When it occurred (optional)

### Fireflies Integration

If you use Fireflies.ai for meeting transcription:
- Meeting transcripts can be automatically imported
- Summaries and action items are extracted

### Personal Inputs vs. Crawled Articles

| Personal Inputs | Crawled Articles |
|-----------------|------------------|
| Never auto-deleted | Deleted after 30 days |
| Your original content | External content |
| Higher priority for generation | Supporting material |

---

## Adding & Generating Content

Create new content or import existing pieces into Thoughtful™.

### Adding Existing Content

Already have content you've written elsewhere? You can add it directly:

1. Go to **Content**
2. Click **+ Add** (plus icon)
3. Fill in the form:
   - **Type**: Select the content type (Blog Post, LinkedIn Post, etc.)
   - **Title**: Give it a descriptive title
   - **Content**: Paste your content (Markdown supported)
   - **Status**: Set to Draft, Ready, Published, or Archived
   - **Published URL**: (If published) Link to where it's live
   - **Publish Date**: (If published) When it was published
4. Click **Add Content**

This is great for:
- Importing blog posts from your existing website
- Adding LinkedIn posts you've already published
- Bringing in content created before you started using Thoughtful™
- Creating content from scratch without AI generation

---

### Generating Content

Transform your sources and inputs into polished content.

### Content Formats

| Format | Best For |
|--------|----------|
| **LinkedIn Post** | Professional insights, short-form thought leadership |
| **Twitter Post** | Quick takes, engagement bait |
| **Blog Post** | Long-form articles, SEO content |
| **Newsletter** | Weekly roundups, subscriber engagement |
| **Video Script** | YouTube, TikTok, or presentation scripts |
| **Podcast Segment** | Talking points, show notes |

### Generation Methods

#### 1. From Sources (Recommended)

Use extracted insights from your feeds and inputs:

1. Go to **Generate**
2. Select **sources** (crawled articles, personal inputs)
3. Choose your **format(s)**
4. Add optional **instructions** (e.g., "Focus on the leadership angle")
5. Click **Generate**

#### 2. From Existing Assets

Repurpose content you've already created:

1. Go to **Generate**
2. Select **existing assets** (e.g., 3 LinkedIn posts)
3. Choose a new format (e.g., Newsletter)
4. Add instructions (e.g., "Create a weekly roundup from these posts")
5. Click **Generate**

#### 3. Prompt-Only

Generate from a custom prompt without sources:

1. Go to **Generate**
2. Skip source selection
3. Enter detailed **instructions** describing what you want
4. Choose your format(s)
5. Click **Generate**

### Generation Tips

- **More sources = richer content**: Use 3-5 sources for best results
- **Be specific with instructions**: "Focus on actionable tips" works better than "make it good"
- **Mix source types**: Combine articles with personal notes for unique perspectives
- **Your content profile matters**: Keep it updated for consistent voice

---

## Enriching Content

Enrichment adds professional polish to your blog posts and newsletters.

### What Enrichment Adds

| Element | Description |
|---------|-------------|
| **Pull Quotes** | Impactful sentences formatted as blockquotes |
| **External Links** | Citations to authoritative sources (HBR, research, etc.) |
| **Internal Links** | Links to your own published content |
| **Image Suggestions** | Descriptions for visuals to add |
| **SEO Metadata** | Title, meta description, slug (blog posts) |
| **Subject Lines** | 3 options for email subject lines (newsletters) |

### How to Enrich

1. Open an asset (blog post or newsletter)
2. Click **Enrich**
3. Wait 15-30 seconds for processing
4. Review the enriched content
5. Copy the markdown output

### Enrichment Output

**Blog posts** include YAML frontmatter:
```yaml
---
title: "Your Optimized Title"
slug: "your-optimized-title"
excerpt: "A compelling excerpt for previews"
meta_description: "SEO-optimized description"
author_slug: "author"
featured_image: "descriptive-image-name.jpg"
published: false
tags:
  - leadership
  - management
---
```

**Newsletters** include:
```yaml
---
subject_line_1: "Option 1"
subject_line_2: "Option 2"
subject_line_3: "Option 3"
preview_text: "Email preview text"
published: false
tags:
  - weekly-roundup
---
```

### Setting Up Internal Links

To get internal link suggestions:

1. Go to **Settings**
2. Add your **Publishing Website URL** (e.g., `https://yourblog.com`)
3. The system will crawl your sitemap to find linking opportunities

---

## Tags and Organization

Tags help you organize and find content across your library.

### Creating Tags

1. Go to **Content** or **Tags** section
2. Click **Manage Tags** or **Create Tag**
3. Enter:
   - **Name**: Tag name (e.g., "Leadership")
   - **Color**: Pick a color for visual identification
   - **Favorite**: Toggle to show in quick-access bar

### Using Tags

- **Add tags to assets**: Click the tag icon on any asset
- **Filter by tag**: Use the tag dropdown or click a favorite tag
- **Bulk tagging**: Select multiple assets and apply tags

### Favorite Tags

Favorite tags appear in the quick-access bar at the top of the Content page:
- Click a favorite tag to instantly filter
- Great for campaigns, content series, or priority topics

### Tag Strategies

| Strategy | Example Tags |
|----------|--------------|
| **By Topic** | Leadership, Sales, Marketing, Product |
| **By Status** | Needs Review, Ready to Publish, Published |
| **By Campaign** | Q1 Launch, Webinar Series, Book Promo |
| **By Platform** | LinkedIn Ready, Blog Ready, Newsletter |

---

## Settings and Content Profile

### General Settings

| Setting | Description |
|---------|-------------|
| **Crawl Schedule** | How often to fetch new articles (manual, daily, every 6 hours) |
| **Generation Schedule** | Auto-generation frequency (manual, daily, weekly) |
| **Content Formats** | Default formats for auto-generation |
| **Timezone** | Your local timezone for scheduling |

### Content Profile

Your content profile shapes how AI generates content in your voice.

| Field | Description | Example |
|-------|-------------|---------|
| **Professional Background** | Your experience and expertise | "15 years in B2B SaaS marketing, former CMO" |
| **Content Pillars** | Topics you write about (3-5) | Leadership, Go-to-Market, Team Building |
| **Target Audience** | Who you're writing for | "B2B startup founders and marketing leaders" |
| **Voice & Tone** | How you sound | "Conversational but authoritative, uses analogies" |
| **Unique Angle** | Your differentiator | "Practical advice from in-the-trenches experience" |
| **Signature Elements** | Recurring themes or phrases | "Always includes one actionable takeaway" |

### Publishing Settings

| Setting | Description |
|---------|-------------|
| **Publishing Website URL** | Your blog/website for internal link suggestions |

---

## Common Workflows

### Weekly LinkedIn Content

1. **Monday**: Review crawled articles from the week
2. **Tuesday**: Add any personal notes or meeting insights
3. **Wednesday**: Generate 5 LinkedIn posts from best sources
4. **Thursday**: Review, edit, and tag generated content
5. **Friday**: Schedule posts for the following week

### Monthly Newsletter

1. Go to **Generate**
2. Select your best **5-10 LinkedIn posts** from the month
3. Choose **Newsletter** format
4. Add instructions: "Create a monthly roundup with intro and key themes"
5. Generate and **Enrich**
6. Copy markdown and send via your email platform

### Blog Post from Scratch

1. Add a **Manual Note** with your outline/ideas
2. Find 2-3 **relevant articles** from your feeds
3. Generate a **Blog Post** using these sources
4. **Enrich** to add links, quotes, and SEO metadata
5. Copy markdown to your CMS

### Repurposing Content

**Long → Short:**
- Blog Post → 3-5 LinkedIn Posts

**Short → Long:**
- 5 LinkedIn Posts → 1 Newsletter
- 3 LinkedIn Posts → 1 Blog Post

**Cross-Platform:**
- LinkedIn Post → Twitter Thread
- Blog Post → Video Script

---

## Tips and Best Practices

### For Better Generation

1. **Update your content profile regularly** - It's the foundation of your voice
2. **Use 3-5 sources per generation** - Too few = generic, too many = unfocused
3. **Mix source types** - Combine articles with personal notes for unique takes
4. **Be specific with instructions** - Tell it exactly what angle you want
5. **Generate multiple formats at once** - Repurpose efficiently

### For Better Organization

1. **Create a tagging system early** - It's easier to maintain than fix later
2. **Use favorite tags** - Keep your most-used tags one click away
3. **Archive, don't delete** - Published content is reference material
4. **Review weekly** - Don't let your content library become overwhelming

### For Better Content

1. **Edit AI output** - It's a starting point, not a final draft
2. **Add personal stories** - AI can't invent your experiences
3. **Check external links** - Verify they're real and relevant
4. **Maintain consistency** - Publish regularly, even if less frequently

### Common Mistakes to Avoid

| Mistake | Solution |
|---------|----------|
| Empty content profile | Fill it out completely for better results |
| Too many sources | Stick to 3-5 highly relevant ones |
| No instructions | Always add context about what you want |
| Publishing without review | Always edit and personalize AI output |
| Ignoring personal inputs | Your notes are your secret weapon |

---

## Quick Reference

### Keyboard Shortcuts

(If implemented in frontend)

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + G` | Open Generate |
| `Cmd/Ctrl + E` | Enrich current asset |
| `Cmd/Ctrl + K` | Quick search |

### Content Status Flow

```
Draft → Ready → Published → Archived
```

- **Draft**: Work in progress
- **Ready**: Reviewed and ready to publish
- **Published**: Live on your platform
- **Archived**: No longer active but preserved

### Support

For questions or issues:
- Check this guide first
- Contact your admin
- Report bugs via the appropriate channel

---

*Last updated: January 2025*
