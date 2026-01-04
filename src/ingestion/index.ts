/**
 * Ingestion Module
 *
 * Aggregates all ingestion handlers for the three source types:
 * 1. Trends/signals (links, posts, newsletters)
 * 2. Meeting recordings (transcripts)
 * 3. Voice notes (short recordings)
 */

export { ingestTrends } from './trends';
export { ingestMeetingTranscript } from './meetings';
export { ingestVoiceNote } from './voice-notes';
