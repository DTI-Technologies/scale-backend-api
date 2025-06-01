import mongoose, { Document, Schema } from 'mongoose';

export enum UsageEventType {
  PROMPT = 'prompt',
  CODE_COMPLETION = 'code_completion',
  DEPENDENCY_VISUALIZATION = 'dependency_visualization',
  KNOWLEDGE_BASE = 'knowledge_base',
  FINE_TUNING = 'fine_tuning',
  CHAT = 'chat',
  AGENT = 'agent'
}

export interface IUsageEvent extends Document {
  userId: string;
  eventId: string;
  type: UsageEventType;
  feature: string;
  timestamp: Date;
  metadata: {
    model?: string;
    tokensUsed?: number;
    responseTime?: number;
    success?: boolean;
    errorMessage?: string;
    source?: string; // vscode_chat, vscode_agent, etc.
    extensionVersion?: string;
  };
  createdAt: Date;
}

const UsageEventSchema = new Schema<IUsageEvent>({
  userId: { type: String, required: true, index: true },
  eventId: { type: String, required: true, unique: true },
  type: { 
    type: String, 
    enum: Object.values(UsageEventType), 
    required: true 
  },
  feature: { type: String, required: true },
  timestamp: { type: Date, required: true, default: Date.now },
  metadata: {
    model: { type: String },
    tokensUsed: { type: Number },
    responseTime: { type: Number },
    success: { type: Boolean, default: true },
    errorMessage: { type: String },
    source: { type: String },
    extensionVersion: { type: String }
  }
}, {
  timestamps: true
});

// Indexes for analytics and performance
UsageEventSchema.index({ userId: 1, timestamp: -1 });
UsageEventSchema.index({ type: 1, timestamp: -1 });
UsageEventSchema.index({ 'metadata.source': 1 });
UsageEventSchema.index({ timestamp: -1 });

// TTL index to automatically delete old events after 1 year
UsageEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });

export const UsageEvent = mongoose.model<IUsageEvent>('UsageEvent', UsageEventSchema);
