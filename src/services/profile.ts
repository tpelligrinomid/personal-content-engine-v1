/**
 * Content Profile Service
 *
 * Builds profile context for content generation based on user settings.
 */

import { getDb } from './db';
import { UserSettings } from '../types';

export interface ContentProfile {
  content_pillars: string[];
  professional_background: string | null;
  target_audience: string | null;
  voice_tone: string | null;
  unique_angle: string | null;
  signature_elements: string | null;
}

/**
 * Fetch the content profile for a user
 */
export async function getContentProfile(userId: string): Promise<ContentProfile | null> {
  const db = getDb();

  const { data: settings, error } = await db
    .from('user_settings')
    .select(
      'content_pillars, professional_background, target_audience, voice_tone, unique_angle, signature_elements'
    )
    .eq('user_id', userId)
    .single();

  if (error || !settings) {
    return null;
  }

  return settings as ContentProfile;
}

/**
 * Build a profile context string to prepend to generation prompts
 */
export function buildProfileContext(profile: ContentProfile | null): string {
  if (!profile) {
    return '';
  }

  const sections: string[] = [];

  // Check if profile has any meaningful content
  const hasPillars = profile.content_pillars && profile.content_pillars.length > 0;
  const hasBackground = profile.professional_background?.trim();
  const hasAudience = profile.target_audience?.trim();
  const hasVoice = profile.voice_tone?.trim();
  const hasAngle = profile.unique_angle?.trim();
  const hasSignature = profile.signature_elements?.trim();

  if (!hasPillars && !hasBackground && !hasAudience && !hasVoice && !hasAngle && !hasSignature) {
    return '';
  }

  sections.push('=== CONTENT CREATOR PROFILE ===');
  sections.push('Use this profile to shape the voice, perspective, and focus of the generated content.\n');

  if (hasPillars) {
    sections.push(`**Content Pillars** (core topics to focus on):`);
    sections.push(profile.content_pillars.map((p) => `  - ${p}`).join('\n'));
    sections.push('');
  }

  if (hasBackground) {
    sections.push(`**Professional Background:**`);
    sections.push(profile.professional_background!);
    sections.push('');
  }

  if (hasAudience) {
    sections.push(`**Target Audience:**`);
    sections.push(profile.target_audience!);
    sections.push('');
  }

  if (hasVoice) {
    sections.push(`**Voice & Tone:**`);
    sections.push(profile.voice_tone!);
    sections.push('');
  }

  if (hasAngle) {
    sections.push(`**Unique Angle:**`);
    sections.push(profile.unique_angle!);
    sections.push('');
  }

  if (hasSignature) {
    sections.push(`**Signature Elements:**`);
    sections.push(profile.signature_elements!);
    sections.push('');
  }

  sections.push('=== END PROFILE ===\n');

  return sections.join('\n');
}

/**
 * Convenience function to get profile context for a user in one call
 */
export async function getProfileContextForUser(userId: string): Promise<string> {
  const profile = await getContentProfile(userId);
  return buildProfileContext(profile);
}
