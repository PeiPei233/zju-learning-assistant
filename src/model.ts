export interface LearningCourse {
  id: number;
  name: string;
  semester_id: number;
  academic_year_id: number;
  instructors?: { name?: string | null }[] | null;
}

export interface Upload {
  course_id: number
  id: number
  reference_id: number
  file_name: string
  course_name: string
  path: string
  size: number
  activity_id: number | null
  allow_private_wps_office_view: boolean
}

export interface Progress {
  id: string
  status: string
  file_name: string
  downloaded_size: number
  total_size: number
  msg: string
}

export interface Subject {
  course_id: number
  sub_id: number
  course_name: string
  sub_name: string
  lecturer_name: string
  path: string
  ppt_image_urls: string[]
}

export class Config {
  save_path!: string
  to_pdf!: boolean
  auto_download!: boolean
  excluded_upload_extensions!: string[]
  ding_url!: string
  ding_secret!: string
  score_auto_sync!: boolean
  todo_auto_sync!: boolean
  score_system_notification!: boolean
  score_ding_notification!: boolean
  todo_system_notification!: boolean
  todo_ding_notification!: boolean
  todo_reminder_minutes!: number[]
  auto_open_download_list!: boolean
  auto_select_all_courseware!: boolean
  theme!: 'system' | 'light' | 'dark'
  tray!: boolean
  max_concurrent_tasks!: number
  auto_start!: boolean
  download_subtitle!: boolean
  subtitle_language!: string[]
  subtitle_format!: string
  subtitle_with_timestamps!: boolean

  llm_enabled!: boolean
  llm_api_base!: string
  llm_api_key!: string
  llm_model!: string
  llm_temperature!: number
  llm_prompt!: string
  llm_hide_think_tag!: boolean

  constructor(config?: Partial<Config>) {
    Object.assign(this, { theme: 'system', ding_secret: '', score_auto_sync: true, todo_auto_sync: true, score_system_notification: true, score_ding_notification: false, todo_system_notification: true, todo_ding_notification: false, todo_reminder_minutes: [60], excluded_upload_extensions: [], auto_open_download_list: false, auto_select_all_courseware: true }, config);
  }

  clone(): Config {
    return new Config({ ...this });
  }
}

export interface VersionInfo {
  update_available: boolean;
  can_install?: boolean;
  prepare_error?: string | null;
  version: string;
  notes: string;
  notes_error?: string | null;
  url: string;
}

export interface ScoreItem {
  course_id: string;
  course_name: string;
  grade: string;
  credits: string;
  grade_point: string;
  makeup_grade: string;
}

export interface TodoItem {
  id: number | string;
  course_id: number | string;
  title: string;
  course_name: string;
  end_time: string | null;
}
