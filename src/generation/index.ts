/**
 * Generation Module
 *
 * Handles weekly batch content generation:
 * - 1 newsletter draft
 * - 1 blog post draft
 * - 5-6 LinkedIn post drafts
 */

export { generateNewsletterDraft } from './newsletter';
export { generateBlogPostDraft } from './blog-post';
export { generateLinkedInDrafts } from './linkedin';

// TODO: Add batch orchestrator that runs all generation
// TODO: Add scheduling logic for weekly execution
