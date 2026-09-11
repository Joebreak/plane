export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type MessageDirection = 'in' | 'out'
export type MessageStatus = 'received' | 'sent' | 'failed'
export type ScheduledStatus = 'pending' | 'sent' | 'failed' | 'cancelled'
export type FlowMatchMode = 'exact' | 'contains'
export type FlowStepType = 'send_text' | 'ask_text' | 'ask_choice' | 'ask_date' | 'ask_time'
export type FlowSessionStatus = 'active' | 'completed' | 'cancelled'

export interface Database {
  public: {
    Tables: {
      admin_profiles: {
        Row: {
          id: string
          email: string | null
          display_name: string | null
          created_at: string
        }
        Insert: {
          id: string
          email?: string | null
          display_name?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          email?: string | null
          display_name?: string | null
          created_at?: string
        }
        Relationships: []
      }
      line_channels: {
        Row: {
          id: string
          name: string
          webhook_key: string
          channel_access_token: string
          channel_secret: string
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name?: string
          webhook_key: string
          channel_access_token: string
          channel_secret: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          webhook_key?: string
          channel_access_token?: string
          channel_secret?: string
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      line_users: {
        Row: {
          id: string
          channel_id: string | null
          line_user_id: string
          display_name: string | null
          picture_url: string | null
          status_message: string | null
          last_interaction_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          channel_id?: string | null
          line_user_id: string
          display_name?: string | null
          picture_url?: string | null
          status_message?: string | null
          last_interaction_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          channel_id?: string | null
          line_user_id?: string
          display_name?: string | null
          picture_url?: string | null
          status_message?: string | null
          last_interaction_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'line_users_channel_id_fkey'
            columns: ['channel_id']
            isOneToOne: false
            referencedRelation: 'line_channels'
            referencedColumns: ['id']
          },
        ]
      }
      conversations: {
        Row: {
          id: string
          line_user_id: string
          last_message_at: string | null
          last_message_preview: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          line_user_id: string
          last_message_at?: string | null
          last_message_preview?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          line_user_id?: string
          last_message_at?: string | null
          last_message_preview?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'conversations_line_user_id_fkey'
            columns: ['line_user_id']
            isOneToOne: true
            referencedRelation: 'line_users'
            referencedColumns: ['id']
          },
        ]
      }
      messages: {
        Row: {
          id: string
          conversation_id: string
          line_user_id: string
          direction: MessageDirection
          content: string
          message_type: string
          line_message_id: string | null
          status: MessageStatus
          created_at: string
        }
        Insert: {
          id?: string
          conversation_id: string
          line_user_id: string
          direction: MessageDirection
          content: string
          message_type?: string
          line_message_id?: string | null
          status?: MessageStatus
          created_at?: string
        }
        Update: {
          id?: string
          conversation_id?: string
          line_user_id?: string
          direction?: MessageDirection
          content?: string
          message_type?: string
          line_message_id?: string | null
          status?: MessageStatus
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'messages_conversation_id_fkey'
            columns: ['conversation_id']
            isOneToOne: false
            referencedRelation: 'conversations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'messages_line_user_id_fkey'
            columns: ['line_user_id']
            isOneToOne: false
            referencedRelation: 'line_users'
            referencedColumns: ['id']
          },
        ]
      }
      scheduled_messages: {
        Row: {
          id: string
          line_user_id: string | null
          content: string
          send_at: string
          status: ScheduledStatus
          error_message: string | null
          created_by: string | null
          created_at: string
          sent_at: string | null
        }
        Insert: {
          id?: string
          line_user_id?: string | null
          content: string
          send_at: string
          status?: ScheduledStatus
          error_message?: string | null
          created_by?: string | null
          created_at?: string
          sent_at?: string | null
        }
        Update: {
          id?: string
          line_user_id?: string | null
          content?: string
          send_at?: string
          status?: ScheduledStatus
          error_message?: string | null
          created_by?: string | null
          created_at?: string
          sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'scheduled_messages_line_user_id_fkey'
            columns: ['line_user_id']
            isOneToOne: false
            referencedRelation: 'line_users'
            referencedColumns: ['id']
          },
        ]
      }
      flow_rules: {
        Row: {
          id: string
          channel_id: string | null
          name: string
          match_mode: FlowMatchMode
          trigger_text: string
          reply_text: string
          priority: number
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          channel_id?: string | null
          name?: string
          match_mode?: FlowMatchMode
          trigger_text: string
          reply_text: string
          priority?: number
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          channel_id?: string | null
          name?: string
          match_mode?: FlowMatchMode
          trigger_text?: string
          reply_text?: string
          priority?: number
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'flow_rules_channel_id_fkey'
            columns: ['channel_id']
            isOneToOne: false
            referencedRelation: 'line_channels'
            referencedColumns: ['id']
          },
        ]
      }
      flows: {
        Row: {
          id: string
          channel_id: string | null
          name: string
          trigger_text: string
          match_mode: FlowMatchMode
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          channel_id?: string | null
          name: string
          trigger_text: string
          match_mode?: FlowMatchMode
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          channel_id?: string | null
          name?: string
          trigger_text?: string
          match_mode?: FlowMatchMode
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      flow_steps: {
        Row: {
          id: string
          flow_id: string
          step_key: string
          sort_order: number
          step_type: FlowStepType
          prompt_text: string
          field_key: string | null
          choices: { label: string; value: string }[]
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          flow_id: string
          step_key: string
          sort_order?: number
          step_type?: FlowStepType
          prompt_text: string
          field_key?: string | null
          choices?: { label: string; value: string }[]
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          flow_id?: string
          step_key?: string
          sort_order?: number
          step_type?: FlowStepType
          prompt_text?: string
          field_key?: string | null
          choices?: { label: string; value: string }[]
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      flow_sessions: {
        Row: {
          id: string
          line_user_id: string
          channel_id: string
          flow_id: string
          current_step_key: string | null
          answers: Record<string, string>
          status: FlowSessionStatus
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          line_user_id: string
          channel_id: string
          flow_id: string
          current_step_key?: string | null
          answers?: Record<string, string>
          status?: FlowSessionStatus
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          line_user_id?: string
          channel_id?: string
          flow_id?: string
          current_step_key?: string | null
          answers?: Record<string, string>
          status?: FlowSessionStatus
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: {
      message_direction: MessageDirection
      message_status: MessageStatus
      scheduled_status: ScheduledStatus
      flow_match_mode: FlowMatchMode
      flow_step_type: FlowStepType
      flow_session_status: FlowSessionStatus
    }
    CompositeTypes: Record<string, never>
  }
}

export type LineUser = Database['public']['Tables']['line_users']['Row']
export type LineChannel = Database['public']['Tables']['line_channels']['Row']
export type AdminProfile = Database['public']['Tables']['admin_profiles']['Row']
export type Conversation = Database['public']['Tables']['conversations']['Row']
export type Message = Database['public']['Tables']['messages']['Row']
export type ScheduledMessage = Database['public']['Tables']['scheduled_messages']['Row']
export type FlowRule = Database['public']['Tables']['flow_rules']['Row']
export type Flow = Database['public']['Tables']['flows']['Row']
export type FlowStep = Database['public']['Tables']['flow_steps']['Row']
export type FlowSession = Database['public']['Tables']['flow_sessions']['Row']

export type ConversationWithUser = Conversation & {
  line_users: LineUser | null
}
