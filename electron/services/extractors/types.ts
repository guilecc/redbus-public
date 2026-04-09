/**
 * Unified Message Types for the Executive Inbox.
 *
 * Architecture: Playwright headless + LLM interpretation.
 * Playwright navigates to Outlook/Teams, captures DOM text,
 * and the LLM Worker extracts structured messages from it.
 */

export type ChannelId = 'outlook' | 'teams';

export type UrgencyLevel = 'unknown' | 'low' | 'medium' | 'high';

export interface UnifiedMessage {
  channel: ChannelId;
  sender: string;
  subject?: string;       // Outlook only
  preview: string;        // body preview or last message text
  timestamp?: string;     // ISO 8601 if available
  urgency: UrgencyLevel;  // set to 'unknown' by extractors, classified by LLM later
  isUnread: boolean;
}

export type ChannelStatus = 'disconnected' | 'authenticating' | 'connected' | 'extracting' | 'error';

export interface ChannelState {
  id: ChannelId;
  label: string;
  url: string;
  status: ChannelStatus;
  lastPollAt: string | null;
  lastMessages: UnifiedMessage[];
  errorMessage?: string;
}

export interface BriefingResult {
  generatedAt: string;
  totalMessages: number;
  urgentCount: number;
  briefingText: string;
  messages: UnifiedMessage[];
  draftReplies?: Array<{
    channel: ChannelId;
    sender: string;
    draft: string;
  }>;
}
