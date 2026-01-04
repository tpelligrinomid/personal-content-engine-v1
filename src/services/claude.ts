/**
 * Claude API client for content extraction and generation
 */

import Anthropic from '@anthropic-ai/sdk';

let client: Anthropic | null = null;

export function getClaudeClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      throw new Error('Missing ANTHROPIC_API_KEY environment variable');
    }

    client = new Anthropic({ apiKey });
  }

  return client;
}

export interface ExtractionResult {
  summary: string;
  key_points: string[];
  topics: string[];
}

const EXTRACTION_PROMPT = `You are analyzing content to extract key information. Given the following content, provide:

1. A concise summary (2-3 paragraphs max)
2. Key points (5-10 bullet points of the most important takeaways)
3. Topics (3-7 topic tags that categorize this content)

Respond in JSON format exactly like this:
{
  "summary": "...",
  "key_points": ["point 1", "point 2", ...],
  "topics": ["topic1", "topic2", ...]
}

Content to analyze:
`;

export async function extractFromContent(
  content: string,
  contentType: 'meeting' | 'voice_note' | 'trend' | 'manual_note' | 'document'
): Promise<ExtractionResult> {
  const claude = getClaudeClient();

  const contextPrefix = getContextPrefix(contentType);

  const response = await claude.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [
      {
        role: 'user',
        content: `${EXTRACTION_PROMPT}${contextPrefix}\n\n${content}`,
      },
    ],
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Claude');
  }

  const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Could not parse JSON from Claude response');
  }

  const result = JSON.parse(jsonMatch[0]) as ExtractionResult;

  if (!result.summary || !Array.isArray(result.key_points) || !Array.isArray(result.topics)) {
    throw new Error('Invalid extraction result format');
  }

  return result;
}

function getContextPrefix(contentType: string): string {
  switch (contentType) {
    case 'meeting':
      return '[This is a meeting transcript. Focus on decisions, action items, and key discussion points.]';
    case 'voice_note':
      return '[This is a personal voice note. Focus on the main ideas and any actionable thoughts.]';
    case 'trend':
      return '[This is a trend/signal from external sources. Focus on the main insight and why it matters.]';
    case 'manual_note':
      return '[This is a manually written note. Extract the core message and key points.]';
    case 'document':
      return '[This is a document/article. Summarize the main argument and key takeaways.]';
    default:
      return '';
  }
}

export const EXTRACTION_MODEL = 'claude-sonnet-4-20250514';
