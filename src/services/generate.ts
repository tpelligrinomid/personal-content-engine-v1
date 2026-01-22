/**
 * Content generation service
 *
 * Uses Claude to generate weekly content from extractions
 */

import { getClaudeClient } from './claude';
import { getProfileContextForUser } from './profile';
import { Extraction } from '../types';

export const GENERATION_MODEL = 'claude-opus-4-5-20251101';

interface GeneratedContent {
  title: string;
  content: string;
}

// Internal type for generation - doesn't need user_id since we're processing
interface ExtractionWithSource extends Omit<Extraction, 'user_id'> {
  user_id?: string; // Optional for internal processing
  source_title?: string;
  source_type?: string;
}

function buildExtractionContext(extractions: ExtractionWithSource[]): string {
  return extractions
    .map((e, i) => {
      const header = `[${i + 1}] ${e.source_title || 'Untitled'} (${e.source_type || 'unknown'})`;
      const summary = e.summary || '';
      const keyPoints = e.key_points?.map((p) => `  - ${p}`).join('\n') || '';
      const topics = e.topics?.join(', ') || '';

      return `${header}\nSummary: ${summary}\nKey Points:\n${keyPoints}\nTopics: ${topics}`;
    })
    .join('\n\n---\n\n');
}

const NEWSLETTER_PROMPT = `You are writing a weekly newsletter using the "Personal Content Machine" framework. This newsletter has exactly 4 fixed sections that never change - only the content changes.

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

Extractions from this week (note the source types - use personal sources for The Signal, external/article sources for Market Pulse):
`;

const BLOG_POST_PROMPT = `You are writing a blog post based on the following extractions from meetings, voice notes, and trends. Create an insightful, valuable blog post.

The blog post should:
- Have an SEO-friendly title
- Focus on the most compelling theme or insight from the extractions
- Provide actionable value to readers
- Be well-structured with headers
- Be around 800-1200 words
- Include a conclusion with key takeaways

Respond in JSON format:
{
  "title": "Blog post title",
  "content": "Full blog post content in markdown"
}

Extractions from this week:
`;

const LINKEDIN_PROMPT = `You are creating LinkedIn posts based on the following extractions. Create 5-6 distinct LinkedIn posts, each focusing on a different insight or theme.

Each post should:
- Be 150-300 words (LinkedIn optimal length)
- Start with a hook that grabs attention
- Provide value or insight
- End with engagement prompt or call to action
- Be professional but personable
- NOT use hashtags excessively (max 3 per post)

Respond in JSON format:
{
  "posts": [
    { "title": "Brief topic/hook", "content": "Full post content" },
    ...
  ]
}

Extractions from this week:
`;

const TWITTER_PROMPT = `You are creating Twitter/X posts based on the following extractions. Create 5-6 distinct tweets or short threads.

Each should:
- Be concise and punchy
- Single tweets under 280 characters, or threads of 2-3 tweets
- Focus on one key insight each
- Be engaging and shareable

Respond in JSON format:
{
  "posts": [
    { "title": "Brief topic", "content": "Tweet or thread (separate tweets with ---)" },
    ...
  ]
}

Extractions from this week:
`;

async function generateFromPrompt(
  prompt: string,
  extractions: ExtractionWithSource[],
  profileContext?: string
): Promise<string> {
  const claude = getClaudeClient();
  const context = buildExtractionContext(extractions);

  // Build full prompt with profile context prepended
  let fullPrompt = '';
  if (profileContext) {
    fullPrompt += `${profileContext}\n`;
  }
  fullPrompt += `${prompt}\n\n${context}`;

  const response = await claude.messages.create({
    model: GENERATION_MODEL,
    max_tokens: 4000,
    messages: [
      {
        role: 'user',
        content: fullPrompt,
      },
    ],
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Claude');
  }

  return textBlock.text;
}

function parseJsonResponse(text: string): unknown {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Could not parse JSON from response');
  }
  return JSON.parse(jsonMatch[0]);
}

export async function generateNewsletter(
  extractions: ExtractionWithSource[],
  profileContext?: string
): Promise<GeneratedContent> {
  const response = await generateFromPrompt(NEWSLETTER_PROMPT, extractions, profileContext);
  const parsed = parseJsonResponse(response) as GeneratedContent;

  if (!parsed.title || !parsed.content) {
    throw new Error('Invalid newsletter response format');
  }

  return parsed;
}

export async function generateBlogPost(
  extractions: ExtractionWithSource[],
  profileContext?: string
): Promise<GeneratedContent> {
  const response = await generateFromPrompt(BLOG_POST_PROMPT, extractions, profileContext);
  const parsed = parseJsonResponse(response) as GeneratedContent;

  if (!parsed.title || !parsed.content) {
    throw new Error('Invalid blog post response format');
  }

  return parsed;
}

export async function generateLinkedInPosts(
  extractions: ExtractionWithSource[],
  profileContext?: string
): Promise<GeneratedContent[]> {
  const response = await generateFromPrompt(LINKEDIN_PROMPT, extractions, profileContext);
  const parsed = parseJsonResponse(response) as { posts: GeneratedContent[] };

  if (!parsed.posts || !Array.isArray(parsed.posts)) {
    throw new Error('Invalid LinkedIn response format');
  }

  return parsed.posts;
}

export async function generateTwitterPosts(
  extractions: ExtractionWithSource[],
  profileContext?: string
): Promise<GeneratedContent[]> {
  const response = await generateFromPrompt(TWITTER_PROMPT, extractions, profileContext);
  const parsed = parseJsonResponse(response) as { posts: GeneratedContent[] };

  if (!parsed.posts || !Array.isArray(parsed.posts)) {
    throw new Error('Invalid Twitter response format');
  }

  return parsed.posts;
}

// Re-export for convenience
export { getProfileContextForUser };
