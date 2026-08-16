/**
 * Hand-written Supabase types matching supabase/migrations/0001_init.sql.
 *
 * Each table/view carries `Relationships: []` because @supabase/postgrest-js
 * requires it on GenericTable/GenericView for select-query type inference.
 *
 * Once the project is linked, regenerate with:
 *   supabase gen types typescript --project-id <ref> --schema public > src/types/database.ts
 */

export type UserRole = 'rep' | 'manager' | 'admin' | 'technician';
export type TerritoryType = 'b2b' | 'd2d' | 'mixed';
export type VisitType = 'b2b_visit' | 'd2d_knock' | 'installation';
export type InstallStatus =
  | 'pending'
  | 'scheduled'
  | 'in_progress'
  | 'done'
  | 'needs_revisit';
export type DispositionType =
  | 'no_answer'
  | 'not_home'
  | 'refused'
  | 'interested'
  | 'appointment_set'
  | 'sold'
  | 'do_not_knock';
export type ContactLifecycle = 'lead' | 'customer' | 'lost';
export type DealStatus = 'open' | 'won' | 'lost';
export type PriorityLevel = 'vip' | 'high' | 'medium' | 'low';
export type ContactSource =
  | 'd2d_knock'
  | 'b2b_field'
  | 'referral'
  | 'walk_in'
  | 'import'
  | 'manual';
export type ActivityType = 'call' | 'whatsapp' | 'note';

/** One installation-checklist step (stored per-job in installations.checklist). */
export interface ChecklistItem {
  key: string;
  label: string;
  done: boolean;
}

/** One installed unit (stored in installations.equipment). */
export interface EquipmentItem {
  label: string;
  serial: string;
}

export interface Database {
  // supabase-js ≥2.48 reads this marker to derive result types; without it the
  // query-result inference can collapse to `never`.
  __InternalSupabase: {
    PostgrestVersion: '12';
  };
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          email: string;
          username: string | null;
          full_name: string | null;
          role: UserRole;
          can_do_b2b: boolean;
          can_do_d2d: boolean;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id: string;
          email: string;
          username?: string | null;
          full_name?: string | null;
          role?: UserRole;
          can_do_b2b?: boolean;
          can_do_d2d?: boolean;
          is_active?: boolean;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['users']['Insert']>;
        Relationships: [];
      };
      territories: {
        Row: {
          id: string;
          name: string;
          type: TerritoryType;
          manager_id: string | null;
          polygon: unknown | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          type: TerritoryType;
          manager_id?: string | null;
          polygon?: unknown | null;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['territories']['Insert']>;
        Relationships: [];
      };
      user_territories: {
        Row: { user_id: string; territory_id: string };
        Insert: { user_id: string; territory_id: string };
        Update: Partial<{ user_id: string; territory_id: string }>;
        Relationships: [];
      };
      pipeline_stages: {
        Row: {
          id: string;
          name: string;
          sort_order: number;
          is_won: boolean;
          is_lost: boolean;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          sort_order?: number;
          is_won?: boolean;
          is_lost?: boolean;
          is_active?: boolean;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['pipeline_stages']['Insert']>;
        Relationships: [];
      };
      contacts: {
        Row: {
          id: string;
          client_uuid: string | null;
          name: string | null;
          phone: string | null;
          address: string | null;
          lat: number | null;
          lng: number | null;
          lifecycle: ContactLifecycle;
          pipeline_stage_id: string | null;
          priority: PriorityLevel;
          is_active: boolean;
          tags: string[];
          source: ContactSource;
          assigned_rep_id: string | null;
          territory_id: string | null;
          value_xof: number | null;
          lost_reason: string | null;
          do_not_contact: boolean;
          converted_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_uuid?: string | null;
          name?: string | null;
          phone?: string | null;
          address?: string | null;
          lat?: number | null;
          lng?: number | null;
          lifecycle?: ContactLifecycle;
          pipeline_stage_id?: string | null;
          priority?: PriorityLevel;
          is_active?: boolean;
          tags?: string[];
          source?: ContactSource;
          assigned_rep_id?: string | null;
          territory_id?: string | null;
          value_xof?: number | null;
          lost_reason?: string | null;
          do_not_contact?: boolean;
          converted_at?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['contacts']['Insert']>;
        Relationships: [];
      };
      products: {
        Row: {
          id: string;
          name: string;
          price_xof: number;
          commission_pct: number;
          is_active: boolean;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          price_xof?: number;
          commission_pct?: number;
          is_active?: boolean;
          sort_order?: number;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['products']['Insert']>;
        Relationships: [];
      };
      deals: {
        Row: {
          id: string;
          contact_id: string;
          title: string | null;
          product_id: string | null;
          value_xof: number | null;
          pipeline_stage_id: string | null;
          status: DealStatus;
          needs_installation: boolean;
          lost_reason: string | null;
          assigned_rep_id: string | null;
          won_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          contact_id: string;
          title?: string | null;
          product_id?: string | null;
          value_xof?: number | null;
          pipeline_stage_id?: string | null;
          status?: DealStatus;
          needs_installation?: boolean;
          lost_reason?: string | null;
          assigned_rep_id?: string | null;
          won_at?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['deals']['Insert']>;
        Relationships: [];
      };
      installations: {
        Row: {
          id: string;
          contact_id: string;
          deal_id: string | null;
          title: string | null;
          installer_id: string | null;
          status: InstallStatus;
          checklist: ChecklistItem[];
          equipment: EquipmentItem[];
          scheduled_date: string | null;
          started_at: string | null;
          completed_at: string | null;
          next_visit_date: string | null;
          notes: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          contact_id: string;
          deal_id?: string | null;
          title?: string | null;
          installer_id?: string | null;
          status?: InstallStatus;
          checklist?: ChecklistItem[];
          equipment?: EquipmentItem[];
          scheduled_date?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          next_visit_date?: string | null;
          notes?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['installations']['Insert']>;
        Relationships: [];
      };
      install_protocol_steps: {
        Row: {
          id: string;
          key: string;
          label: string;
          sort_order: number;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          key: string;
          label: string;
          sort_order?: number;
          is_active?: boolean;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['install_protocol_steps']['Insert']>;
        Relationships: [];
      };
      visits: {
        Row: {
          id: string;
          client_uuid: string | null;
          contact_id: string | null;
          deal_id: string | null;
          rep_id: string;
          visit_type: VisitType;
          visited_at: string;
          lat: number | null;
          lng: number | null;
          notes: string | null;
          disposition: DispositionType | null;
          appointment_date: string | null;
          next_visit_date: string | null;
          synced_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          client_uuid?: string | null;
          contact_id?: string | null;
          deal_id?: string | null;
          rep_id: string;
          visit_type: VisitType;
          visited_at: string;
          lat?: number | null;
          lng?: number | null;
          notes?: string | null;
          disposition?: DispositionType | null;
          appointment_date?: string | null;
          next_visit_date?: string | null;
          synced_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['visits']['Insert']>;
        Relationships: [];
      };
      visit_photos: {
        Row: {
          id: string;
          visit_id: string;
          storage_path: string;
          caption: string | null;
          taken_at: string;
        };
        Insert: {
          id?: string;
          visit_id: string;
          storage_path: string;
          caption?: string | null;
          taken_at?: string;
        };
        Update: Partial<Database['public']['Tables']['visit_photos']['Insert']>;
        Relationships: [];
      };
      activities: {
        Row: {
          id: string;
          client_uuid: string | null;
          type: ActivityType;
          contact_id: string | null;
          rep_id: string | null;
          content: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          client_uuid?: string | null;
          type: ActivityType;
          contact_id?: string | null;
          rep_id?: string | null;
          content?: string | null;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['activities']['Insert']>;
        Relationships: [];
      };
      do_not_knock_list: {
        Row: {
          id: string;
          address: string | null;
          lat: number;
          lng: number;
          reason: string | null;
          added_by: string | null;
          added_at: string;
        };
        Insert: {
          id?: string;
          address?: string | null;
          lat: number;
          lng: number;
          reason?: string | null;
          added_by?: string | null;
          added_at?: string;
        };
        Update: Partial<Database['public']['Tables']['do_not_knock_list']['Insert']>;
        Relationships: [];
      };
      sync_conflicts: {
        Row: {
          id: string;
          table_name: string;
          record_id: string | null;
          rep_id: string | null;
          local_data: Record<string, unknown> | null;
          remote_data: Record<string, unknown> | null;
          created_at: string;
          resolved_at: string | null;
          resolution: string | null;
        };
        Insert: {
          id?: string;
          table_name: string;
          record_id?: string | null;
          rep_id?: string | null;
          local_data?: Record<string, unknown> | null;
          remote_data?: Record<string, unknown> | null;
          created_at?: string;
          resolved_at?: string | null;
          resolution?: string | null;
        };
        Update: Partial<Database['public']['Tables']['sync_conflicts']['Insert']>;
        Relationships: [];
      };
    };
    Views: {
      flagged_visits: {
        Row: Database['public']['Tables']['visits']['Row'] & {
          out_of_turf: boolean;
          implausible_rate: boolean;
          rapid_fire: boolean;
        };
        Relationships: [];
      };
    };
    Functions: {
      create_territory: {
        Args: {
          p_name: string;
          p_type: TerritoryType;
          p_geojson: Record<string, unknown>;
        };
        Returns: string;
      };
      territories_geojson: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          name: string;
          type: TerritoryType;
          created_at: string;
          geojson: Record<string, unknown>;
        }[];
      };
      near_do_not_knock: {
        Args: { p_lat: number; p_lng: number };
        Returns: boolean;
      };
      point_in_my_turf: {
        Args: { p_lat: number; p_lng: number };
        Returns: boolean;
      };
    };
    Enums: {
      user_role: UserRole;
      territory_type: TerritoryType;
      visit_type: VisitType;
      disposition_type: DispositionType;
      contact_lifecycle: ContactLifecycle;
      deal_status: DealStatus;
      priority_level: PriorityLevel;
      contact_source: ContactSource;
      activity_type: ActivityType;
      install_status: InstallStatus;
    };
    CompositeTypes: Record<string, never>;
  };
}
