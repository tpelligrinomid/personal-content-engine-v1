/**
 * Content generation service
 *
 * Uses Claude to generate weekly content from extractions
 */

import { getClaudeClient } from './claude';
import { Extraction } from '../types';

export const GENERATION_MODEL = 'claude-sonnet-4-20250514';

interface GeneratedContent {
  title: string;
  content: string;
}

interface ExtractionWithSource extends Extraction {
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

const NEWSLETTER_PROMPT = `You are writing a weekly newsletter for a professional audience. Based on the following extractions from meetings, voice notes, and trends, create an engaging newsletter.

The newsletter should:
- Have a compelling subject line as the title
- Open with a brief personal intro (1-2 sentences)
- Synthesize the key themes and insights from the week
- Be conversational but professional
- Include 3-5 main sections based on themes
- End with a takeaway or call to action
- Be around 500-800 words

Respond in JSON format:
{
  "title": "Newsletter subject line",
  "content": "Full newsletter content in markdown"
}

Extractions from this week:
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
  extractions: ExtractionWithSource[]
): Promise<string> {
  const claude = getClaudeClient();
  const context = buildExtractionContext(extractions);

  const response = await claude.messages.create({
    model: GENERATION_MODEL,
    max_tokens: 4000,
    messages: [
      {
        role: 'user',
        content: `${prompt}\n\n${context}`,
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
  extractions: ExtractionWithSource[]
): Promise<GeneratedContent> {
  const response = await generateFromPrompt(NEWSLETTER_PROMPT, extractions);
  const parsed = parseJsonResponse(response) as GeneratedContent;

  if (!parsed.title || !parsed.content) {
    throw new Error('Invalid newsletter response format');
  }

  return parsed;
}

export async function generateBlogPost(
  extractions: ExtractionWithSource[]
): Promise<GeneratedContent> {
  const response = await generateFromPrompt(BLOG_POST_PROMPT, extractions);
  const parsed = parseJsonResponse(response) as GeneratedContent;

  if (!parsed.title || !parsed.content) {
    throw new Error('Invalid blog post response format');
  }

  return parsed;
}

export async function generateLinkedInPosts(
  extractions: ExtractionWithSource[]
): Promise<GeneratedContent[]> {
  const response = await generateFromPrompt(LINKEDIN_PROMPT, extractions);
  const parsed = parseJsonResponse(response) as { posts: GeneratedContent[] };

  if (!parsed.posts || !Array.isArray(parsed.posts)) {
    throw new Error('Invalid LinkedIn response format');
  }

  return parsed.posts;
}

export async function generateTwitterPosts(
  extractions: ExtractionWithSource[]
): Promise<GeneratedContent[]> {
  const response = await generateFromPrompt(TWITTER_PROMPT, extractions);
  const parsed = parseJsonResponse(response) as { posts: GeneratedContent[] };

  if (!parsed.posts || !Array.isArray(parsed.posts)) {
    throw new Error('Invalid Twitter response format');
  }

  return parsed.posts;
}
