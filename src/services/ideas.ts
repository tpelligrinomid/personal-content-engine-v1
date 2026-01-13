/**
 * Idea Spark Service
 *
 * Generates infinite content ideas by combining:
 * - User's content pillars
 * - Recent extractions from consumed content
 * - User's existing content assets
 * - Crawled article titles
 *
 * Uses Claude to assemble natural, specific prompts.
 */

import { getDb } from './db';
import { getClaudeClient } from './claude';

const IDEA_MODEL = 'claude-sonnet-4-20250514';

// Idea types for variety
const IDEA_TYPES = [
  'pillar_question',      // Direct question about a pillar
  'extraction_reaction',  // React to something they read
  'content_remix',        // Expand/remix their existing content
  'cross_pollination',    // Combine two pillars
  'contrarian_take',      // Argue against a point
  'story_prompt',         // Tell a story about...
  'trend_commentary',     // React to a recent article
  'audience_flip',        // Explain to different audience
  'format_challenge',     // Different format constraint
  'mistake_lesson',       // What's a common mistake...
] as const;

type IdeaType = typeof IDEA_TYPES[number];

// Random constraints to add variety
const CONSTRAINTS = [
  'in under 100 words',
  'as a hot take',
  'for someone just starting out',
  'with a specific example',
  'as a story',
  'in a controversial way',
  'as advice to your past self',
  'as a prediction',
  'as a lesson learned the hard way',
  'with an unexpected analogy',
  null, // no constraint
  null,
  null, // weight toward no constraint
];

// Audiences for variety
const AUDIENCES = [
  'startup founders',
  'first-time managers',
  'seasoned executives',
  'solopreneurs',
  'agency owners',
  'people considering a career change',
  'skeptics',
  'beginners',
  'experts who think they know it all',
];

interface IdeaContext {
  pillars: string[];
  extractions: Array<{
    summary: string;
    source_title: string | null;
    topics: string[] | null;
  }>;
  assets: Array<{
    title: string | null;
    content: string;
    type: string;
  }>;
  articleTitles: string[];
}

interface GeneratedIdea {
  id: string;
  prompt: string;
  source_type: IdeaType;
  source_context: string | null;
  pillar: string | null;
}

function randomChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomChoices<T>(arr: T[], count: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function generateId(): string {
  return `idea_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Fetch context data for idea generation
 */
async function fetchIdeaContext(userId: string): Promise<IdeaContext> {
  const db = getDb();

  // Get user's content pillars
  const { data: settings } = await db
    .from('user_settings')
    .select('content_pillars')
    .eq('user_id', userId)
    .single();

  const pillars = settings?.content_pillars || [];

  // Get recent extractions (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data: extractions } = await db
    .from('extractions')
    .select(`
      summary,
      topics,
      source_materials (title),
      documents (title)
    `)
    .eq('user_id', userId)
    .gte('created_at', thirtyDaysAgo.toISOString())
    .order('created_at', { ascending: false })
    .limit(50);

  const extractionData = (extractions || []).map((e: any) => ({
    summary: e.summary,
    source_title: e.source_materials?.title ?? e.documents?.title ?? null,
    topics: e.topics,
  }));

  // Get user's existing content assets
  const { data: assets } = await db
    .from('assets')
    .select('title, content, type')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(30);

  const assetData = (assets || []).map((a: any) => ({
    title: a.title,
    content: a.content?.substring(0, 500) || '', // First 500 chars
    type: a.type,
  }));

  // Get recent article titles from documents
  const { data: documents } = await db
    .from('documents')
    .select('title')
    .eq('user_id', userId)
    .not('title', 'is', null)
    .order('created_at', { ascending: false })
    .limit(30);

  const articleTitles = (documents || [])
    .map((d: any) => d.title)
    .filter((t: string | null): t is string => t !== null);

  return {
    pillars,
    extractions: extractionData,
    assets: assetData,
    articleTitles,
  };
}

/**
 * Build prompt for Claude based on idea type and context
 */
function buildIdeaPrompt(
  ideaType: IdeaType,
  context: IdeaContext
): { systemContext: string; selectedPillar: string | null; sourceContext: string | null } {
  const constraint = randomChoice(CONSTRAINTS);
  const constraintText = constraint ? ` The prompt should encourage a response ${constraint}.` : '';

  let systemContext = '';
  let selectedPillar: string | null = null;
  let sourceContext: string | null = null;

  switch (ideaType) {
    case 'pillar_question': {
      selectedPillar = randomChoice(context.pillars);
      systemContext = `Generate a thought-provoking question or prompt about "${selectedPillar}" that would inspire a LinkedIn post or blog article.${constraintText} The question should be specific and actionable, not generic.`;
      break;
    }

    case 'extraction_reaction': {
      if (context.extractions.length === 0) {
        // Fallback to pillar question
        selectedPillar = randomChoice(context.pillars);
        systemContext = `Generate a thought-provoking question about "${selectedPillar}".${constraintText}`;
      } else {
        const extraction = randomChoice(context.extractions);
        sourceContext = extraction.source_title || 'a recent article';
        systemContext = `Based on this summary from "${sourceContext}": "${extraction.summary?.substring(0, 300)}..."

Generate a prompt that asks the user to share their reaction, opinion, or related experience.${constraintText}`;
      }
      break;
    }

    case 'content_remix': {
      if (context.assets.length === 0) {
        selectedPillar = randomChoice(context.pillars);
        systemContext = `Generate a content prompt about "${selectedPillar}".${constraintText}`;
      } else {
        const asset = randomChoice(context.assets);
        sourceContext = asset.title || 'a previous post';
        systemContext = `The user previously wrote this ${asset.type.replace('_', ' ')}: "${asset.content.substring(0, 300)}..."

Generate a prompt that asks them to expand on this, share a follow-up thought, or explore a related angle.${constraintText}`;
      }
      break;
    }

    case 'cross_pollination': {
      if (context.pillars.length >= 2) {
        const [pillar1, pillar2] = randomChoices(context.pillars, 2);
        selectedPillar = `${pillar1} + ${pillar2}`;
        systemContext = `Generate a prompt that asks the user to explore the intersection of "${pillar1}" and "${pillar2}". How do these topics relate? What can one teach us about the other?${constraintText}`;
      } else {
        selectedPillar = context.pillars[0] || 'their expertise';
        systemContext = `Generate a thought-provoking question about "${selectedPillar}".${constraintText}`;
      }
      break;
    }

    case 'contrarian_take': {
      if (context.extractions.length > 0) {
        const extraction = randomChoice(context.extractions);
        sourceContext = extraction.source_title || 'conventional wisdom';
        systemContext = `Based on this point: "${extraction.summary?.substring(0, 200)}..."

Generate a prompt that challenges the user to argue the opposite side or share a contrarian perspective.${constraintText}`;
      } else {
        selectedPillar = randomChoice(context.pillars);
        systemContext = `Generate a prompt asking for a contrarian or unpopular opinion about "${selectedPillar}".${constraintText}`;
      }
      break;
    }

    case 'story_prompt': {
      selectedPillar = randomChoice(context.pillars);
      systemContext = `Generate a storytelling prompt about "${selectedPillar}". Ask the user to share a specific experience, lesson learned, or memorable moment related to this topic.${constraintText}`;
      break;
    }

    case 'trend_commentary': {
      if (context.articleTitles.length > 0) {
        const title = randomChoice(context.articleTitles);
        sourceContext = title;
        systemContext = `Based on this article the user read: "${title}"

Generate a prompt asking them to share their take, reaction, or how this relates to their experience.${constraintText}`;
      } else {
        selectedPillar = randomChoice(context.pillars);
        systemContext = `Generate a prompt about current trends in "${selectedPillar}".${constraintText}`;
      }
      break;
    }

    case 'audience_flip': {
      selectedPillar = randomChoice(context.pillars);
      const audience = randomChoice(AUDIENCES);
      systemContext = `Generate a prompt asking the user to explain "${selectedPillar}" specifically for ${audience}. What would they need to know? What advice would you give them?${constraintText}`;
      break;
    }

    case 'format_challenge': {
      selectedPillar = randomChoice(context.pillars);
      const formats = ['a single tweet', 'a 3-part framework', 'a numbered list', 'a story with a twist', 'a bold prediction', 'a "here\'s what I learned" post'];
      const format = randomChoice(formats);
      systemContext = `Generate a prompt asking the user to write about "${selectedPillar}" as ${format}.${constraintText}`;
      break;
    }

    case 'mistake_lesson': {
      selectedPillar = randomChoice(context.pillars);
      systemContext = `Generate a prompt asking about common mistakes, lessons learned, or things the user wishes they knew earlier about "${selectedPillar}".${constraintText}`;
      break;
    }
  }

  return { systemContext, selectedPillar, sourceContext };
}

/**
 * Generate a single idea using Claude
 */
async function generateSingleIdea(
  context: IdeaContext,
  ideaType?: IdeaType
): Promise<GeneratedIdea> {
  const claude = getClaudeClient();

  // Pick random idea type if not specified
  const type = ideaType || randomChoice([...IDEA_TYPES]);

  const { systemContext, selectedPillar, sourceContext } = buildIdeaPrompt(type, context);

  const response = await claude.messages.create({
    model: IDEA_MODEL,
    max_tokens: 300,
    messages: [
      {
        role: 'user',
        content: `${systemContext}

Output ONLY the prompt/question itself - no preamble, no "Here's a prompt:", just the actual prompt that will inspire the user to write content. Keep it under 50 words. Make it feel personal and specific, not generic.`,
      },
    ],
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  const prompt = textBlock?.type === 'text' ? textBlock.text.trim() : 'What lesson have you learned recently that changed how you work?';

  // Clean up the prompt - remove quotes if Claude wrapped it
  const cleanPrompt = prompt.replace(/^["']|["']$/g, '').trim();

  return {
    id: generateId(),
    prompt: cleanPrompt,
    source_type: type,
    source_context: sourceContext,
    pillar: selectedPillar,
  };
}

/**
 * Generate a single idea for a user
 */
export async function sparkIdea(userId: string): Promise<GeneratedIdea> {
  console.log(`[Ideas] Generating single idea for user ${userId}`);

  const context = await fetchIdeaContext(userId);

  if (context.pillars.length === 0) {
    // No pillars configured, return a generic prompt
    return {
      id: generateId(),
      prompt: 'What\'s one thing you\'ve learned recently that you wish you knew earlier in your career?',
      source_type: 'pillar_question',
      source_context: null,
      pillar: null,
    };
  }

  const idea = await generateSingleIdea(context);
  console.log(`[Ideas] Generated idea: ${idea.source_type} - "${idea.prompt.substring(0, 50)}..."`);

  return idea;
}

/**
 * Generate a batch of ideas for a user
 */
export async function sparkBatch(userId: string, count: number = 5): Promise<GeneratedIdea[]> {
  console.log(`[Ideas] Generating batch of ${count} ideas for user ${userId}`);

  const context = await fetchIdeaContext(userId);

  if (context.pillars.length === 0) {
    return [{
      id: generateId(),
      prompt: 'What\'s one thing you\'ve learned recently that you wish you knew earlier in your career?',
      source_type: 'pillar_question',
      source_context: null,
      pillar: null,
    }];
  }

  // Generate ideas with different types for variety
  const ideas: GeneratedIdea[] = [];
  const usedTypes = new Set<IdeaType>();

  for (let i = 0; i < count; i++) {
    // Try to use different types for variety
    let ideaType: IdeaType | undefined;
    if (usedTypes.size < IDEA_TYPES.length) {
      const availableTypes = IDEA_TYPES.filter((t) => !usedTypes.has(t));
      ideaType = randomChoice(availableTypes);
      usedTypes.add(ideaType);
    }

    try {
      const idea = await generateSingleIdea(context, ideaType);
      ideas.push(idea);
    } catch (err) {
      console.error(`[Ideas] Error generating idea ${i + 1}:`, err);
    }
  }

  console.log(`[Ideas] Generated ${ideas.length} ideas`);
  return ideas;
}
