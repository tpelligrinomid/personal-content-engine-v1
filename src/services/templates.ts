/**
 * Templates service
 *
 * Provides default prompts with database override capability.
 * If a template exists in the database, it's used. Otherwise, code defaults apply.
 */

import { getDb } from './db';
import { Template } from '../types';

export interface TemplateDefinition {
  key: string;
  name: string;
  description: string;
  defaultPrompt: string;
  suggestedInputs: string;
}

// Default prompts (used when no DB override exists)
const DEFAULT_TEMPLATES: Record<string, TemplateDefinition> = {
  linkedin_post: {
    key: 'linkedin_post',
    name: 'LinkedIn Post',
    description: 'Professional post with hook, insight, and CTA',
    suggestedInputs: '1-3 extractions',
    defaultPrompt: `You are creating a LinkedIn post from the provided content.

The post should:
- Be 150-300 words (LinkedIn optimal length)
- Start with a hook that grabs attention (pattern interrupt, bold claim, or question)
- Provide genuine value or insight
- End with engagement prompt or call to action
- Be professional but personable
- Use short paragraphs (1-2 sentences each) for mobile readability
- NOT use hashtags excessively (max 3, at the end)

Respond in JSON format:
{
  "title": "Brief topic/hook (for internal reference)",
  "content": "Full post content"
}

Content to transform:`,
  },

  linkedin_pov: {
    key: 'linkedin_pov',
    name: 'LinkedIn POV Post',
    description: 'Opinion-driven post with personal perspective',
    suggestedInputs: '1 extraction (preferably from meeting or voice note)',
    defaultPrompt: `You are creating a LinkedIn POV (point of view) post from personal experience content.

The post should:
- Lead with a strong, potentially controversial opinion
- Back it up with personal experience or specific observation
- Challenge conventional wisdom or common advice
- Be authentic and opinionated, not generic
- 150-250 words
- End with a question that invites discussion

Structure:
1. Bold opening statement (the POV)
2. The experience/evidence that led to this view
3. Why this matters or what it means
4. Question to spark engagement

Respond in JSON format:
{
  "title": "The core POV (for internal reference)",
  "content": "Full post content"
}

Content to transform:`,
  },

  twitter_post: {
    key: 'twitter_post',
    name: 'Twitter/X Post',
    description: 'Concise tweet or short thread',
    suggestedInputs: '1-2 extractions',
    defaultPrompt: `You are creating a Twitter/X post from the provided content.

Options:
- Single tweet (under 280 characters)
- Short thread (2-4 tweets, separate with ---)

The post should:
- Be punchy and direct
- Focus on one key insight
- Be engaging and shareable
- Use simple language
- Optional: end with a question or hook for engagement

Respond in JSON format:
{
  "title": "Brief topic (for internal reference)",
  "content": "Tweet or thread (separate tweets with ---)"
}

Content to transform:`,
  },

  twitter_thread: {
    key: 'twitter_thread',
    name: 'Twitter/X Thread',
    description: 'Multi-tweet thread breaking down a topic',
    suggestedInputs: '1-3 extractions',
    defaultPrompt: `You are creating a Twitter/X thread from the provided content.

The thread should:
- Be 4-8 tweets
- First tweet is the hook (must stand alone and grab attention)
- Each tweet builds on the previous one
- Use numbered format (1/, 2/, etc.) or natural flow
- End with a summary or CTA
- Separate tweets with ---

Structure:
1/ Hook - the big idea or question
2-6/ The breakdown, evidence, or story
7/ The takeaway or insight
8/ CTA or question

Respond in JSON format:
{
  "title": "Thread topic (for internal reference)",
  "content": "Full thread (separate tweets with ---)"
}

Content to transform:`,
  },

  blog_post: {
    key: 'blog_post',
    name: 'Blog Post',
    description: 'Long-form article with SEO-friendly structure',
    suggestedInputs: '2-5 extractions',
    defaultPrompt: `You are writing a blog post based on the provided extractions.

The blog post should:
- Have an SEO-friendly title
- Focus on the most compelling theme or insight
- Provide actionable value to readers
- Be well-structured with H2 headers
- Be 800-1200 words
- Include a strong introduction that hooks the reader
- End with clear takeaways

Structure:
- Title (compelling, specific)
- Introduction (hook + what reader will learn)
- 3-5 main sections with H2 headers
- Conclusion with key takeaways

Respond in JSON format:
{
  "title": "Blog post title",
  "content": "Full blog post content in markdown"
}

Content to transform:`,
  },

  newsletter: {
    key: 'newsletter',
    name: 'Newsletter (4-Section)',
    description: 'Personal Content Machine format: Signal, Lever, Pulse, Next Move',
    suggestedInputs: '5+ extractions (mix of personal and external sources)',
    defaultPrompt: `You are writing a weekly newsletter using the "Personal Content Machine" framework. This newsletter has exactly 4 fixed sections that never change - only the content changes.

Based on the extractions provided, create a newsletter with these 4 sections:

## Section 1: The Signal (Personal Insight / POV)
**Purpose:** Establish taste, credibility, and voice
**Source:** Use extractions from meetings, voice notes, or manual notes - the personal/lived experience content
**What goes here:**
- A short personal story or recent realization
- A strong POV on what's changing or what's broken
- Something from a deal, client call, build, or mistake
**Length:** 150-300 words
**This is the emotional hook that can't be automated - make it genuine and opinionated.**

## Section 2: The Lever (Tool, Tactic, or System)
**Purpose:** Deliver immediate, practical value
**Source:** Tools, workflows, frameworks, or tactics mentioned in any extraction
**What goes here:**
- A tool being used (or ditched)
- A workflow that's been standardized
- A framework being refined
**Structure:** The problem → The approach → The outcome
**Length:** 100-250 words
**This is the "I can use this" moment that justifies the subscription.**

## Section 3: The Market Pulse (Trend, Pattern, or Data Point)
**Purpose:** Show awareness of the broader market
**Source:** Use extractions from articles, trends, and external content
**What goes here:**
- A trend noticed across multiple sources
- A pattern emerging from the data
- A "this keeps coming up" observation
**Length:** 100-200 words
**Position the author as forward-looking and well-informed.**

## Section 4: The Next Move (Action, Question, or Resource)
**Purpose:** Close the loop and invite engagement
**What goes here:**
- A question being thought through
- A resource being read or built
- A light CTA (reply, read, connect)
**Length:** 50-100 words
**Turn the newsletter from a broadcast into a conversation.**

IMPORTANT FORMATTING:
- Use markdown with clear ## headers for each section
- Use the exact section names: "The Signal", "The Lever", "The Market Pulse", "The Next Move"
- Be conversational but professional
- Total length: 400-850 words

Respond in JSON format:
{
  "title": "Newsletter subject line (compelling, specific)",
  "content": "Full newsletter content in markdown with the 4 sections"
}

Content to transform:`,
  },

  video_script: {
    key: 'video_script',
    name: 'Short Video Script',
    description: 'Script for TikTok, Reels, or YouTube Shorts (30-90 seconds)',
    suggestedInputs: '1-2 extractions',
    defaultPrompt: `You are creating a short-form video script (TikTok, Instagram Reels, YouTube Shorts) from the provided content.

The script should:
- Be 30-90 seconds when spoken (roughly 75-225 words)
- Hook viewers in the first 3 seconds
- Deliver ONE clear insight or value point
- Be conversational and energetic
- End with a strong closer (CTA, punchline, or thought-provoker)

Structure:
**HOOK (0-3 sec):** Pattern interrupt, bold claim, or intriguing question
**SETUP (3-15 sec):** Quick context - what problem or topic you're addressing
**CORE (15-60 sec):** The main insight, tip, or story - be specific and actionable
**CLOSER (last 10-15 sec):** Memorable ending - callback to hook, CTA, or mic drop moment

Formatting:
- Write in spoken language (contractions, casual tone)
- Include [VISUAL CUE] suggestions in brackets where helpful
- Mark emphasis with *asterisks* for words to stress

Respond in JSON format:
{
  "title": "Video topic/hook (for internal reference)",
  "content": "Full script with sections labeled"
}

Content to transform:`,
  },

  podcast_segment: {
    key: 'podcast_segment',
    name: 'Podcast Segment Script',
    description: 'Solo podcast segment or talking points (5-10 minutes)',
    suggestedInputs: '2-4 extractions',
    defaultPrompt: `You are creating a podcast segment script from the provided content. This is for a solo host segment that runs 5-10 minutes.

The segment should:
- Be 750-1500 words (roughly 5-10 minutes spoken)
- Sound natural when read aloud
- Have clear structure but conversational flow
- Include transitions between points
- Provide genuine insight or value

Structure:
**INTRO (30-60 sec):**
- Hook the listener with why this matters NOW
- Preview what they'll learn/gain

**MAIN CONTENT (4-7 min):**
- 2-4 key points with examples or stories
- Use conversational transitions ("Here's the thing...", "And this is where it gets interesting...")
- Include specific examples, not just abstract concepts

**OUTRO (30-60 sec):**
- Summarize the key takeaway (one sentence)
- Give a specific action or reflection prompt
- Optional: tease what's coming next or invite engagement

Formatting:
- Write how you'd actually speak (contractions, natural pauses)
- Use [PAUSE] markers for emphasis moments
- Include [TRANSITION] markers between major points
- Bullet sub-points for easy reference while recording

Respond in JSON format:
{
  "title": "Segment topic (for internal reference)",
  "content": "Full script with sections and markers"
}

Content to transform:`,
  },
};

/**
 * Get all available template definitions (for listing)
 */
export function getAvailableTemplates(): Array<{
  key: string;
  name: string;
  description: string;
  suggestedInputs: string;
}> {
  return Object.values(DEFAULT_TEMPLATES).map((t) => ({
    key: t.key,
    name: t.name,
    description: t.description,
    suggestedInputs: t.suggestedInputs,
  }));
}

/**
 * Get the prompt for a template (checks DB override first, then code default)
 */
export async function getTemplatePrompt(templateKey: string): Promise<string | null> {
  const defaultTemplate = DEFAULT_TEMPLATES[templateKey];

  if (!defaultTemplate) {
    return null; // Unknown template
  }

  // Check for DB override
  const db = getDb();
  const { data: override } = await db
    .from('templates')
    .select('prompt')
    .eq('template_key', templateKey)
    .eq('active', true)
    .single();

  if (override && override.prompt) {
    console.log(`[Templates] Using DB override for: ${templateKey}`);
    return override.prompt;
  }

  console.log(`[Templates] Using default for: ${templateKey}`);
  return defaultTemplate.defaultPrompt;
}

/**
 * Get full template info including whether it has an override
 */
export async function getTemplateInfo(templateKey: string): Promise<{
  key: string;
  name: string;
  description: string;
  suggestedInputs: string;
  prompt: string;
  hasOverride: boolean;
} | null> {
  const defaultTemplate = DEFAULT_TEMPLATES[templateKey];

  if (!defaultTemplate) {
    return null;
  }

  const db = getDb();
  const { data: override } = await db
    .from('templates')
    .select('*')
    .eq('template_key', templateKey)
    .eq('active', true)
    .single();

  return {
    key: defaultTemplate.key,
    name: override?.name || defaultTemplate.name,
    description: override?.description || defaultTemplate.description,
    suggestedInputs: defaultTemplate.suggestedInputs,
    prompt: override?.prompt || defaultTemplate.defaultPrompt,
    hasOverride: !!override,
  };
}

/**
 * Check if a template key is valid
 */
export function isValidTemplateKey(key: string): boolean {
  return key in DEFAULT_TEMPLATES;
}
